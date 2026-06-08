import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineGame } from '../hooks/useOnlineGame';
import { reducer } from '../hooks/useGame';
import GameBoard from './GameBoard';

const HEARTBEAT_INTERVAL = 30_000; // write presence every 30s
const ACTIVE_STALE_MS    = 60_000; // active player stalls turn after 2 missed beats
const STALE_THRESHOLD    = 90_000; // any player kicked after this (safety net)

export default function OnlineGameBoard() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [room, setRoom] = useState(null);

  useEffect(() => {
    if (!roomId || loading) return;
    return onSnapshot(doc(db, 'rooms', roomId), (snap) => {
      if (!snap.exists()) { navigate('/'); return; }
      setRoom({ id: snap.id, ...snap.data() });
    });
  }, [roomId, loading]);

  if (loading || !room || !user) {
    return <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p>Connecting…</p>
    </div>;
  }

  return (
    <OnlineGameBoardInner
      room={room}
      roomId={roomId}
      myUid={user.uid}
    />
  );
}

function OnlineGameBoardInner({ room, roomId, myUid }) {
  // ── Presence: write heartbeat every 30s so others can detect disconnect ──
  useEffect(() => {
    const writePresence = () =>
      updateDoc(doc(db, 'rooms', roomId), {
        [`presence.${myUid}`]: serverTimestamp(),
      }).catch(() => {});

    writePresence();
    const id = setInterval(writePresence, HEARTBEAT_INTERVAL);

    // Also fire on pagehide (more reliable than useEffect cleanup on mobile)
    const onPageHide = () => writePresence();
    window.addEventListener('pagehide', onPageHide);

    // CRITICAL for iOS: Safari/WebViews fully suspend JS (and the heartbeat
    // interval) while backgrounded — lock screen, a notification, app-switch.
    // On a brief background the player's heartbeat goes stale and the auto-play/
    // stale-detector can play their turn for them, so on return it's no longer
    // their turn ("iOS won't let me move"). Re-send the heartbeat the moment the
    // app becomes visible/focused again so a quick background never marks them
    // stale. (Won't save a background longer than ACTIVE_STALE_MS — that player
    // is genuinely away.)
    const onResume = () => { if (document.visibilityState === 'visible') writePresence(); };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('pageshow', onResume);
    window.addEventListener('focus', onResume);

    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('pageshow', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, []);

  // No active-game unmount cleanup: closing the tab leaves the player's seat
  // intact so they can rejoin seamlessly. Stale-presence (above) is the sole
  // removal mechanism once a heartbeat is >90s old.

  const setupPlayers = room.players.map(p => ({
    color: p.color,
    name: p.name,
    uid: p.uid,
  }));

  const gameHook = useOnlineGame(setupPlayers, roomId, room.players, room.gameState, myUid, room.hostUid);

  // The recoverer drives cross-player recovery writes (stale-skip, auto-play,
  // kick). It's the FIRST currently-present player in seat order — normally the
  // host (seat 0), but if the host has disconnected, authority falls to the next
  // present player so the room never freezes waiting for an absent host. A
  // player with no presence entry yet (just connected) counts as present. This
  // mirrors isRecoverer()/hostStale() in firestore.rules, which authorizes any
  // member once the host's heartbeat is stale.
  const recovererUid = (() => {
    const now = Date.now();
    const present = room.players.find(p => {
      const last = room.presence?.[p.uid]?.toMillis?.();
      return last == null || now - last < ACTIVE_STALE_MS;
    });
    return (present ?? room.players[0])?.uid;
  })();
  const canManage = !!myUid && myUid === recovererUid;

  // Remove a player by writing the shrunk room roster AND the recomputed
  // gameState in a SINGLE updateDoc, so the two never diverge (the rules'
  // isRemovalCascade requires the gameState player count to match the room
  // roster in the same write). The REMOVE_PLAYER reducer eliminates their
  // pieces/specials/bridges and advances the turn. Last-write-wins + the
  // reducer's no-op-on-missing-color make concurrent recoverer writes safe.
  const removePlayer = useCallback((targetUid, color) => {
    if (!canManage) return;
    const remaining = room.players.filter(p => p.uid !== targetUid);
    const updates = {
      players: remaining,
      playerUids: remaining.map(p => p.uid),
      updatedAt: serverTimestamp(),
    };
    if (room.hostUid === targetUid && remaining.length > 0) {
      updates.hostUid = remaining[0].uid;
    }
    if (color && room.gameState) {
      updates.gameState = reducer(gameHook.state, { type: 'REMOVE_PLAYER', color });
    }
    updateDoc(doc(db, 'rooms', roomId), updates).catch(() => {});
  }, [canManage, room.players, room.hostUid, room.gameState, gameHook.state, roomId]);

  // ── Kick watcher: when any player's skipCount reaches 2 in gameState
  //    (set by present-but-idle self-skip via autoAdvance, or by the active-stale
  //    detector below), remove them. ──
  useEffect(() => {
    if (!canManage) return;
    const target = gameHook.state.players.find(p => (p.skipCount ?? 0) >= 2);
    if (!target?.uid) return;
    removePlayer(target.uid, target.color);
  }, [gameHook.state.players, canManage, removePlayer]);

  // ── Stale-presence detection: if another player stopped sending heartbeats,
  //    remove them. ──
  useEffect(() => {
    if (!canManage) return;
    if (gameHook.state.phase === 'game-over') return;
    if (!room.presence) return;

    const now = Date.now();
    const stalePlayer = gameHook.state.players.find(p => {
      if (!p.uid || p.uid === myUid) return false;
      const lastSeen = room.presence[p.uid]?.toMillis?.();
      // Only stale if they have sent at least one heartbeat that is now too old.
      // Players who haven't written yet (just connected) are not stale.
      return lastSeen && now - lastSeen > STALE_THRESHOLD;
    });

    if (stalePlayer) removePlayer(stalePlayer.uid, stalePlayer.color);
  }, [room.presence, gameHook.state.players, gameHook.state.phase, canManage, myUid, removePlayer]);

  // ── Active-player stale detection: auto-play their turn after ACTIVE_STALE_MS;
  //    kick them on a 2nd consecutive skip. ──
  useEffect(() => {
    if (!canManage) return;
    const phase = gameHook.state.phase;
    if (phase === 'game-over' || phase === 'initial-roll') return;
    if (!room.presence) return;
    const active = gameHook.state.players[gameHook.state.currentPlayerIndex];
    if (!active?.uid || active.uid === myUid) return;
    const lastSeen = room.presence[active.uid]?.toMillis?.();
    if (!lastSeen) return;
    if (Date.now() - lastSeen <= ACTIVE_STALE_MS) return;

    if ((active.skipCount ?? 0) >= 1) {
      removePlayer(active.uid, active.color);   // second consecutive skip — kick
    } else {
      // Roll + one random move on the absent player's behalf (counts as a skip).
      gameHook.hostAutoPlay(active.color);      // persisted by the recoverer via useOnlineGame
    }
  }, [room.presence, gameHook.state.currentPlayerIndex, gameHook.state.phase, gameHook.state.players, canManage, myUid, removePlayer]);

  // Use game-state players (not room.players) so indices stay correct after removals
  const myColor = gameHook.state.players.find(p => p.uid === myUid)?.color;
  const isAdmin = myUid === room.hostUid;
  const isMyTurn = (() => {
    if (gameHook.state.phase === 'initial-roll') {
      const { initialRollWinner, initialRollIdx, initialRollOrder } = gameHook.state;
      if (initialRollWinner) return false; // start/reroll handled by isAdmin
      return myColor === initialRollOrder[initialRollIdx];
    }
    return gameHook.state.players[gameHook.state.currentPlayerIndex]?.uid === myUid;
  })();

  return (
    <GameBoard gameHook={gameHook} isMyTurn={isMyTurn} myPlayerColor={myColor} playAgainPath="/lobby" isHost={isAdmin} />
  );
}