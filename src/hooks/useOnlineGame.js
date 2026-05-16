import { useReducer, useCallback, useEffect, useRef } from 'react';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { reducer, initState, getValidMoves } from './useGame';

export function useOnlineGame(setupPlayers, roomId, roomPlayers) {
  const [state, dispatch] = useReducer(reducer, setupPlayers, initState);
  const lastRemoteStateRef = useRef(null);
  const prevRoomColorsRef = useRef(roomPlayers.map(p => p.color));
  const roomColorsKey = roomPlayers.map(p => p.color).join(',');

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
      const str = JSON.stringify(remote);
      if (str === lastRemoteStateRef.current) return;
      lastRemoteStateRef.current = str;
      dispatch({ type: 'SYNC', state: remote });
    });
  }, [roomId]);

  // Local → Firestore: write on every state change, deduped against last known remote
  useEffect(() => {
    if (!roomId) return;
    const str = JSON.stringify(state);
    if (str === lastRemoteStateRef.current) return;
    lastRemoteStateRef.current = str;
    updateDoc(doc(db, 'rooms', roomId), {
      gameState: state,
      updatedAt: serverTimestamp(),
    }).catch(err => {
      console.error('Firestore write failed:', err);
      lastRemoteStateRef.current = null;
    });
  }, [state, roomId]);

  const rollDice           = useCallback(() => dispatch({ type: 'ROLL_DICE' }), []);
  const selectMove         = useCallback(move => dispatch({ type: 'SELECT_MOVE', move }), []);
  const skipPlaceSpecial   = useCallback(() => dispatch({ type: 'SKIP_PLACE_SPECIAL' }), []);
  const placeSpecial       = useCallback((ring, idx, specialType) =>
    dispatch({ type: 'PLACE_SPECIAL', ring, idx, specialType }), []);
  const resolveDuel        = useCallback((atkRoll, defRoll) =>
    dispatch({ type: 'RESOLVE_DUEL', atkRoll, defRoll }), []);
  const duelSetRoll        = useCallback((who, roll) =>
    dispatch({ type: 'DUEL_SET_ROLL', who, roll }), []);
  const resolveMost        = useCallback((cross, trigger) =>
    dispatch({ type: 'RESOLVE_MOST', cross, trigger }), []);
  const resolveKocka       = useCallback((trigger, d1, d2) =>
    dispatch({ type: 'RESOLVE_KOCKA', trigger, d1, d2 }), []);
  const kockaSetRoll       = useCallback((d1, d2) =>
    dispatch({ type: 'KOCKA_SET_ROLL', d1, d2 }), []);
  const resolveZamjena     = useCallback((trigger, targetColor, targetFigId) =>
    dispatch({ type: 'RESOLVE_ZAMJENA', trigger, targetColor, targetFigId }), []);
  const dismissSpecialInfo = useCallback(() => dispatch({ type: 'DISMISS_SPECIAL_INFO' }), []);
  const endTurn            = useCallback(() => dispatch({ type: 'END_TURN' }), []);
  const initialRoll        = useCallback(() => dispatch({ type: 'INITIAL_ROLL' }), []);
  const continueAfterTie   = useCallback(() => dispatch({ type: 'CONTINUE_AFTER_TIE' }), []);
  const startGame          = useCallback(() => dispatch({ type: 'START_GAME' }), []);

  const validMoves    = state.phase === 'moving' ? getValidMoves(state, state.diceValue) : [];
  const currentPlayer = state.players[state.currentPlayerIndex];

  return {
    state, currentPlayer, validMoves,
    rollDice, selectMove, skipPlaceSpecial, placeSpecial,
    resolveDuel, duelSetRoll, resolveMost, resolveKocka, kockaSetRoll, resolveZamjena,
    dismissSpecialInfo, endTurn, initialRoll, continueAfterTie, startGame,
  };
}
