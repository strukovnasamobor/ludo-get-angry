import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineGame } from '../hooks/useOnlineGame';
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

    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', onPageHide);
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

  const gameHook = useOnlineGame(setupPlayers, roomId, room.players, room.gameState);

  // ── Kick watcher: when any player's skipCount reaches 2 in gameState
  //    (set by present-but-idle self-skip via autoAdvance, or by the active-stale
  //    detector below), remove them from room.players. This cascades through
  //    the REMOVE_PLAYER reducer which eliminates their pieces, specials,
  //    bridges, and transfers host if needed. Multiple clients may write
  //    simultaneously — Firestore's last-write-wins makes it idempotent. ──
  useEffect(() => {
    const target = gameHook.state.players.find(p => (p.skipCount ?? 0) >= 2);
    if (!target?.uid) return;
    const remaining = room.players.filter(p => p.uid !== target.uid);
    const updates = {
      players: remaining,
      playerUids: remaining.map(p => p.uid),
      updatedAt: serverTimestamp(),
    };
    if (room.hostUid === target.uid && remaining.length > 0) {
      updates.hostUid = remaining[0].uid;
    }
    updateDoc(doc(db, 'rooms', roomId), updates).catch(() => {});
  }, [gameHook.state.players, room.players, room.hostUid, roomId]);

  // ── Stale-presence detection: if another player stopped sending heartbeats,
  //    remove them from room.players so the existing REMOVE_PLAYER path fires. ──
  useEffect(() => {
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

    if (stalePlayer) {
      const remaining = room.players.filter(p => p.uid !== stalePlayer.uid);
      const updates = {
        players: remaining,
        playerUids: remaining.map(p => p.uid),
        updatedAt: serverTimestamp(),
      };
      if (room.hostUid === stalePlayer.uid && remaining.length > 0) {
        updates.hostUid = remaining[0].uid;
      }
      updateDoc(doc(db, 'rooms', roomId), updates).catch(() => {});
    }
  }, [room.presence, gameHook.state.players, gameHook.state.phase]);

  // ── Active-player stale detection: skip them after ACTIVE_STALE_MS;
  //    kick them on a 2nd consecutive skip. Reuses REMOVE_PLAYER path. ──
  useEffect(() => {
    const phase = gameHook.state.phase;
    if (phase === 'game-over' || phase === 'initial-roll') return;
    if (!room.presence) return;
    const active = gameHook.state.players[gameHook.state.currentPlayerIndex];
    if (!active?.uid || active.uid === myUid) return;
    const lastSeen = room.presence[active.uid]?.toMillis?.();
    if (!lastSeen) return;
    if (Date.now() - lastSeen <= ACTIVE_STALE_MS) return;

    if ((active.skipCount ?? 0) >= 1) {
      // Second consecutive skip — kick.
      const remaining = room.players.filter(p => p.uid !== active.uid);
      const updates = {
        players: remaining,
        playerUids: remaining.map(p => p.uid),
        updatedAt: serverTimestamp(),
      };
      if (room.hostUid === active.uid && remaining.length > 0) {
        updates.hostUid = remaining[0].uid;
      }
      updateDoc(doc(db, 'rooms', roomId), updates).catch(() => {});
    } else {
      gameHook.skipPlayerTurn(active.color);
    }
  }, [room.presence, gameHook.state.currentPlayerIndex, gameHook.state.phase, gameHook.state.players]);

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