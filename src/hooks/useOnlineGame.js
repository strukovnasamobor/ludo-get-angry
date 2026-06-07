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
  // Set when the local player's turn timed out and we committed an AUTO roll, so
  // the derive effect tags ROLL_DICE as `auto` (counts as a skip, not activity).
  const autoRollRef = useRef(false);
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

  // Firestore → local: apply remote state when it changes.
  useEffect(() => {
    if (!roomId) return;
    return onSnapshot(doc(db, 'rooms', roomId), (snap) => {
      if (!snap.exists()) return;
      // Ignore our OWN optimistic (not-yet-confirmed) writes: we already applied
      // them locally via dispatch, so re-applying their echo only causes reverts
      // and dedup races during rapid write bursts (e.g. a 6-bonus: move → seed →
      // derive → move). It also avoids deriving a roll from an unresolved
      // serverTimestamp. Act only on server-confirmed snapshots.
      if (snap.metadata.hasPendingWrites) return;
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

    const idxOf = (s) => (s && s.players ? s.players.findIndex(p => p.uid === myUid) : -1);
    const myIdx = idxOf(state);
    const isCurrent = myIdx !== -1 && state.currentPlayerIndex === myIdx;
    const isHostUser = !!myUid && myUid === hostUid;
    const isSeat0 = !!myUid && myUid === seat0Uid;
    const isDuelDefender = state.phase === 'duel' && state.duelState?.defUid === myUid;

    // Authorize against the PRE-write remote too — the Firestore rules check the
    // *existing* state, and a turn-ending move flips currentPlayerIndex away from
    // us even though we (the previous current player) legitimately made it.
    // Without this, a non-host player's turn-advancing move is never persisted.
    let prev = null;
    if (lastRemoteStateRef.current) {
      try { prev = JSON.parse(lastRemoteStateRef.current); } catch { /* ignore */ }
    }
    const prevIdx = idxOf(prev);
    const wasCurrent = !!prev && prevIdx !== -1 && prev.currentPlayerIndex === prevIdx;
    const wasDuelDefender = prev && prev.phase === 'duel' && prev.duelState?.defUid === myUid;
    const wasInitialRoll = prev && prev.phase === 'initial-roll';

    let canPersist;
    if (!hasRemoteRef.current) {
      canPersist = isHostUser;                 // host-only seed
    } else if (state.phase === 'initial-roll' || wasInitialRoll) {
      canPersist = true;                        // any member rolls / host starts
    } else {
      canPersist = isCurrent || wasCurrent
        || isDuelDefender || wasDuelDefender
        || isHostUser || isSeat0;
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
  // dispatch the roll here — the derive effect below resolves it once the seed
  // round-trips back, so the value is fixed by the server, not the client. The
  // Firestore rules require gameState.rollSeed == request.time and reject any
  // direct dice-value write, so a client can't forge a roll. This one helper
  // backs ALL roll types (main, duel, KOCKA, initial); the derive effect picks
  // the right action from the current phase.
  const commitSeed = useCallback(() => {
    if (!roomId) return;
    updateDoc(doc(db, 'rooms', roomId), {
      'gameState.rollSeed': serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(err => console.error('Roll-seed write failed:', err));
  }, [roomId]);

  // Verifiable roll, phase 2 (derive): once the committed seed arrives, the
  // rightful roller derives the value(s) deterministically and dispatches the
  // matching action. The reducer clears the seed; the rules re-derive and
  // verify the written value(s). Only the rightful roller derives.
  useEffect(() => {
    const seed = state.rollSeed;
    if (!seed || typeof seed.toMillis !== 'function') return;
    const ms = seed.toMillis();
    const myIdx = state.players.findIndex(p => p.uid === myUid);
    const isCurrent = myIdx !== -1 && state.currentPlayerIndex === myIdx;

    if (state.phase === 'rolling' && isCurrent) {
      const auto = autoRollRef.current;
      autoRollRef.current = false;
      dispatch({ type: 'ROLL_DICE', forcedValue: (ms % 6) + 1, auto });
    } else if (state.phase === 'duel' && state.duelState) {
      const ds = state.duelState;
      if (ds.atkRoll == null && isCurrent) {
        dispatch({ type: 'DUEL_SET_ROLL', who: 'atk', roll: (ms % 6) + 1 });
      } else if (ds.atkRoll != null && ds.defRoll == null && ds.defUid === myUid) {
        dispatch({ type: 'DUEL_SET_ROLL', who: 'def', roll: (ms % 6) + 1 });
      }
    } else if (state.phase === 'special-trigger' && state.specialTrigger?.type === 'dice' && isCurrent) {
      dispatch({ type: 'KOCKA_SET_ROLL', d1: (ms % 6) + 1, d2: (Math.floor(ms / 6) % 6) + 1 });
    } else if (state.phase === 'initial-roll'
               && state.initialRollOrder?.[state.initialRollIdx] ===
                  state.players.find(p => p.uid === myUid)?.color) {
      dispatch({ type: 'INITIAL_ROLL', forcedValue: (ms % 6) + 1 });
    }
  }, [state.rollSeed, state.phase, state.currentPlayerIndex, state.players,
      state.duelState, state.specialTrigger, state.initialRollIdx, state.initialRollOrder, myUid]);

  // All roll intents commit a seed; online ignores any client-rolled value the
  // UI passes (offline keeps using it). The derive effect produces the real
  // action. A manual roll clears the auto flag so it isn't mis-counted as a skip.
  const rollDice = useCallback(() => { autoRollRef.current = false; commitSeed(); }, [commitSeed]);
  const selectMove         = useCallback(move => dispatch({ type: 'SELECT_MOVE', move }), []);
  const skipPlaceSpecial   = useCallback(() => dispatch({ type: 'SKIP_PLACE_SPECIAL' }), []);
  const placeSpecial       = useCallback((ring, idx, specialType, bridgeAnchorRing, bridgeAnchorIdx) =>
    dispatch({ type: 'PLACE_SPECIAL', ring, idx, specialType, bridgeAnchorRing, bridgeAnchorIdx }), []);
  const resolveDuel        = useCallback((atkRoll, defRoll) =>
    dispatch({ type: 'RESOLVE_DUEL', atkRoll, defRoll }), []);
  const duelSetRoll        = commitSeed; // online: seed → derive effect writes the verified roll
  const forceDuelTimeout   = useCallback(() =>
    dispatch({ type: 'FORCE_DUEL_TIMEOUT' }), []);
  const resolveMost        = useCallback((cross, trigger, crossOptionIdx) =>
    dispatch({ type: 'RESOLVE_MOST', cross, trigger, crossOptionIdx }), []);
  const resolveKocka       = useCallback((trigger, d1, d2) =>
    dispatch({ type: 'RESOLVE_KOCKA', trigger, d1, d2 }), []);
  const kockaSetRoll       = commitSeed; // online: seed → derive effect writes the verified d1/d2
  const resolveZamjena     = useCallback((trigger, targetColor, targetFigId) =>
    dispatch({ type: 'RESOLVE_ZAMJENA', trigger, targetColor, targetFigId }), []);
  const dismissSpecialInfo = useCallback(() => dispatch({ type: 'DISMISS_SPECIAL_INFO' }), []);
  const endTurn            = useCallback(() => dispatch({ type: 'END_TURN' }), []);
  const skipPlayerTurn     = useCallback((color) => dispatch({ type: 'SKIP_PLAYER_TURN', color }), []);
  const removePlayer       = useCallback((color) => dispatch({ type: 'REMOVE_PLAYER', color }), []);
  const initialRoll        = commitSeed; // online: seed → derive effect writes the verified value
  const continueAfterTie   = useCallback(() => dispatch({ type: 'CONTINUE_AFTER_TIE' }), []);
  const startGame          = useCallback(() => dispatch({ type: 'START_GAME' }), []);
  // Auto-play (present-but-idle): commit a seed flagged as an auto roll; the
  // derive effect resolves it with `auto: true` (counts as a skip). The move
  // follows via autoMove once the roll lands.
  const autoRoll           = useCallback(() => { autoRollRef.current = true; commitSeed(); }, [commitSeed]);
  const autoMove           = useCallback(() => dispatch({ type: 'AUTO_MOVE' }), []);
  // Auto-play a fully-absent player's turn (recoverer/host only): one write.
  const hostAutoPlay       = useCallback((color) => dispatch({ type: 'HOST_AUTO_PLAY', color }), []);

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
    autoRoll, autoMove, hostAutoPlay,
  };
}
