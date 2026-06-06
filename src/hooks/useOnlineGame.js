import { useReducer, useCallback, useEffect, useRef } from 'react';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { reducer, initState, getValidMoves, getPlacementMoves } from './useGame';

export function useOnlineGame(setupPlayers, roomId, roomPlayers, initialGameState, myUid, hostUid) {
  // Lazy-init from the remote gameState when it already exists (rejoin into
  // a game in progress). Falls back to a fresh initial-roll state for brand-new
  // rooms where nothing has been written yet.
  const [state, dispatch] = useReducer(
    reducer,
    null,
    () => initialGameState || initState(setupPlayers)
  );
  // Prime the last-known-remote with the seed we just used so the local→remote
  // write effect doesn't immediately publish an unchanged state.
  const lastRemoteStateRef = useRef(initialGameState ? JSON.stringify(initialGameState) : null);
  // True once a non-null gameState has been observed remotely. Until then the
  // board is unseeded and only the host may publish the (host-only) initial
  // seed — see the persist guard below.
  const hasRemoteRef = useRef(!!initialGameState);
  const prevRoomColorsRef = useRef(roomPlayers.map(p => p.color));
  const roomColorsKey = roomPlayers.map(p => p.color).join(',');
  const seat0Uid = roomPlayers[0]?.uid;

  // Detect player disconnections from the lobby players list
  useEffect(() => {
    const curr = new Set(roomColorsKey.split(',').filter(Boolean));
    prevRoomColorsRef.current.forEach(color => {
      if (!curr.has(color)) dispatch({ type: 'REMOVE_PLAYER', color });
    });
    prevRoomColorsRef.current = roomColorsKey.split(',').filter(Boolean);
  }, [roomColorsKey]);

  // Firestore → local: apply remote state when it changes
  useEffect(() => {
    if (!roomId) return;
    return onSnapshot(doc(db, 'rooms', roomId), (snap) => {
      if (!snap.exists()) return;
      const remote = snap.data().gameState;
      if (!remote) return;
      hasRemoteRef.current = true;
      const str = JSON.stringify(remote);
      if (str === lastRemoteStateRef.current) return;
      lastRemoteStateRef.current = str;
      dispatch({ type: 'SYNC', state: remote });
    });
  }, [roomId]);

  // Local → Firestore: write on every state change, deduped against last known
  // remote. Only the authorized writer for the current situation persists —
  // this mirrors the Firestore rules so unauthorized clients don't generate
  // permission-denied noise, and keeps the board single-writer per moment:
  //   - seeding (no remote yet): host only (the seed is randomized; one writer)
  //   - initial-roll: any member (roller) / host (start)
  //   - duel: the defender (their roll) and the current player (attacker)
  //   - otherwise: the current player, plus a recoverer (host/seat 0) for
  //     stale-skip writes
  // Kick/removal cascades are written directly by OnlineGameBoard, not here.
  useEffect(() => {
    if (!roomId) return;
    const str = JSON.stringify(state);
    if (str === lastRemoteStateRef.current) return;

    const myIdx = state.players.findIndex(p => p.uid === myUid);
    const isCurrent = myIdx !== -1 && state.currentPlayerIndex === myIdx;
    const isHostUser = !!myUid && myUid === hostUid;
    const isSeat0 = !!myUid && myUid === seat0Uid;
    const isDuelDefender = state.phase === 'duel' && state.duelState?.defUid === myUid;

    let canPersist;
    if (!hasRemoteRef.current) {
      canPersist = isHostUser;                 // host-only seed
    } else if (state.phase === 'initial-roll') {
      canPersist = true;                        // any member rolls / host starts
    } else {
      canPersist = isCurrent || isDuelDefender || isHostUser || isSeat0;
    }
    // If myUid is unknown (shouldn't happen online) fall back to permissive so
    // we never brick a session; the rules remain the backstop.
    if (myUid && !canPersist) return;

    lastRemoteStateRef.current = str;
    updateDoc(doc(db, 'rooms', roomId), {
      gameState: state,
      updatedAt: serverTimestamp(),
    }).catch(err => {
      console.error('Firestore write failed:', err);
      lastRemoteStateRef.current = null;
    });
  }, [state, roomId, myUid, hostUid, seat0Uid]);

  // Verifiable roll, phase 1 (init): commit a server-stamped seed. We do NOT
  // dispatch ROLL_DICE here — the derive effect below resolves it once the
  // seed round-trips back, so the value is fixed by the server, not the client.
  // The Firestore rules require gameState.rollSeed == request.time and reject a
  // direct diceValue write, so a client can't forge a roll.
  const rollDice = useCallback(() => {
    if (!roomId) return;
    updateDoc(doc(db, 'rooms', roomId), {
      'gameState.rollSeed': serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(err => console.error('Roll-seed write failed:', err));
  }, [roomId]);

  // Verifiable roll, phase 2 (derive): once the committed seed arrives, the
  // current player derives the die value deterministically and dispatches
  // ROLL_DICE with it. The reducer clears the seed; the rules re-derive and
  // verify the written diceValue. Only the roller derives.
  useEffect(() => {
    const seed = state.rollSeed;
    if (!seed || typeof seed.toMillis !== 'function') return;
    if (state.phase !== 'rolling') return;
    const myIdx = state.players.findIndex(p => p.uid === myUid);
    if (myIdx === -1 || state.currentPlayerIndex !== myIdx) return;
    const val = (seed.toMillis() % 6) + 1;
    dispatch({ type: 'ROLL_DICE', forcedValue: val });
  }, [state.rollSeed, state.phase, state.currentPlayerIndex, state.players, myUid]);
  const selectMove         = useCallback(move => dispatch({ type: 'SELECT_MOVE', move }), []);
  const skipPlaceSpecial   = useCallback(() => dispatch({ type: 'SKIP_PLACE_SPECIAL' }), []);
  const placeSpecial       = useCallback((ring, idx, specialType, bridgeAnchorRing, bridgeAnchorIdx) =>
    dispatch({ type: 'PLACE_SPECIAL', ring, idx, specialType, bridgeAnchorRing, bridgeAnchorIdx }), []);
  const resolveDuel        = useCallback((atkRoll, defRoll) =>
    dispatch({ type: 'RESOLVE_DUEL', atkRoll, defRoll }), []);
  const duelSetRoll        = useCallback((who, roll) =>
    dispatch({ type: 'DUEL_SET_ROLL', who, roll }), []);
  const forceDuelTimeout   = useCallback(() =>
    dispatch({ type: 'FORCE_DUEL_TIMEOUT' }), []);
  const resolveMost        = useCallback((cross, trigger, crossOptionIdx) =>
    dispatch({ type: 'RESOLVE_MOST', cross, trigger, crossOptionIdx }), []);
  const resolveKocka       = useCallback((trigger, d1, d2) =>
    dispatch({ type: 'RESOLVE_KOCKA', trigger, d1, d2 }), []);
  const kockaSetRoll       = useCallback((d1, d2) =>
    dispatch({ type: 'KOCKA_SET_ROLL', d1, d2 }), []);
  const resolveZamjena     = useCallback((trigger, targetColor, targetFigId) =>
    dispatch({ type: 'RESOLVE_ZAMJENA', trigger, targetColor, targetFigId }), []);
  const dismissSpecialInfo = useCallback(() => dispatch({ type: 'DISMISS_SPECIAL_INFO' }), []);
  const endTurn            = useCallback(() => dispatch({ type: 'END_TURN' }), []);
  const skipPlayerTurn     = useCallback((color) => dispatch({ type: 'SKIP_PLAYER_TURN', color }), []);
  const removePlayer       = useCallback((color) => dispatch({ type: 'REMOVE_PLAYER', color }), []);
  const initialRoll        = useCallback(() => dispatch({ type: 'INITIAL_ROLL' }), []);
  const continueAfterTie   = useCallback(() => dispatch({ type: 'CONTINUE_AFTER_TIE' }), []);
  const startGame          = useCallback(() => dispatch({ type: 'START_GAME' }), []);

  const validMoves    = (state.phase === 'moving' || state.phase === 'six-action')
    ? getValidMoves(state, state.diceValue)
    : [];
  const placementMoves = state.phase === 'six-action' ? getPlacementMoves(state) : [];
  const currentPlayer = state.players[state.currentPlayerIndex];

  return {
    state, currentPlayer, validMoves, placementMoves,
    rollDice, selectMove, skipPlaceSpecial, placeSpecial,
    resolveDuel, duelSetRoll, forceDuelTimeout, resolveMost, resolveKocka, kockaSetRoll, resolveZamjena,
    dismissSpecialInfo, endTurn, skipPlayerTurn, removePlayer, initialRoll, continueAfterTie, startGame,
  };
}
