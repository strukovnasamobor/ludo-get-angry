import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineGame } from '../hooks/useOnlineGame';
import GameBoard from './GameBoard';

const HEARTBEAT_INTERVAL = 10_000; // write presence every 10s
const STALE_THRESHOLD    = 30_000; // player considered gone after 30s without heartbeat

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
  const roomRef = useRef(room);
  useEffect(() => { roomRef.current = room; }, [room]);

  // ── Presence: write heartbeat every 10s so others can detect disconnect ──
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

  // ── Cleanup: remove self from room.players on unmount / pagehide ──
  useEffect(() => {
    const doLeave = () => {
      const r = roomRef.current;
      if (!r) return;
      const remaining = r.players.filter(p => p.uid !== myUid);
      const updates = {
        players: remaining,
        playerUids: remaining.map(p => p.uid),
        updatedAt: serverTimestamp(),
      };
      if (r.hostUid === myUid && remaining.length > 0) updates.hostUid = remaining[0].uid;
      updateDoc(doc(db, 'rooms', roomId), updates).catch(() => {});
    };

    window.addEventListener('pagehide', doLeave);
    return () => {
      doLeave();
      window.removeEventListener('pagehide', doLeave);
    };
  }, []);

  const setupPlayers = room.players.map(p => ({
    color: p.color,
    name: p.name,
    uid: p.uid,
  }));

  const gameHook = useOnlineGame(setupPlayers, roomId, room.players);

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

  return <GameBoard gameHook={gameHook} isMyTurn={isMyTurn} myPlayerColor={myColor} playAgainPath="/lobby" isHost={isAdmin} />;
}