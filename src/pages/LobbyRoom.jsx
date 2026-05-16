import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { PLAYER_ORDER, PLAYERS } from '../data/boardLayout';
import Modal from '../components/Modal.jsx';
import './Lobby.css';
import './GameSetup.css';

const COLOR_HEX = Object.fromEntries(
  Object.entries(PLAYERS).map(([k, v]) => [k, v.color])
);

export default function LobbyRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t, lang, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [room, setRoom]           = useState(null);
  const [joined, setJoined]       = useState(false);
  const [error, setError]         = useState('');
  const [myName, setMyName]       = useState('');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const initializedRef      = useRef(false);
  const roomRef             = useRef(null);
  const userRef             = useRef(user);
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { userRef.current = user; }, [user]);

  // Remove self from room when leaving the lobby
  useEffect(() => {
    return () => {
      const r = roomRef.current;
      const u = userRef.current;
      if (r?.status !== 'waiting' || !u) return;
      const remaining = r.players.filter(p => p.uid !== u.uid);
      const remainingUids = remaining.map(p => p.uid);
      const updates = {
        players: remaining,
        playerUids: remainingUids,
        updatedAt: serverTimestamp(),
      };
      if (r.hostUid === u.uid && remaining.length > 0) updates.hostUid = remaining[0].uid;
      updateDoc(doc(db, 'rooms', roomId), updates).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!roomId || loading) return;
    return onSnapshot(doc(db, 'rooms', roomId), (snap) => {
      if (!snap.exists()) { navigate('/lobby'); return; }
      const data = { id: snap.id, ...snap.data() };
      setRoom(data);
      if (data.status === 'active') navigate(`/online/${roomId}`);
    });
  }, [roomId, loading]);

  // Join once room + user are ready
  useEffect(() => {
    if (!room || !user || joined || loading) return;
    const alreadyIn = room.players.some(p => p.uid === user.uid);
    if (alreadyIn) { setJoined(true); return; }

    const takenColors = room.players.map(p => p.color);
    const availableColor = PLAYER_ORDER.find(c => !takenColors.includes(c));
    if (!availableColor) { setError('Room is full.'); return; }

    const entry = {
      uid: user.uid,
      name: user.displayName || user.email?.split('@')[0] || `${t('setupPlayerName')} ${room.players.length + 1}`,
      color: availableColor,
      index: room.players.length,
    };

    updateDoc(doc(db, 'rooms', roomId), {
      players: arrayUnion(entry),
      playerUids: arrayUnion(user.uid),
      updatedAt: serverTimestamp(),
    })
      .then(() => setJoined(true))
      .catch(err => { console.error(err); setError('Could not join room.'); });
  }, [room, user, joined, loading]);

  // Initialize local name once from Firestore (only on first join)
  const me = room?.players.find(p => p.uid === user?.uid);
  useEffect(() => {
    if (initializedRef.current || !me) return;
    setMyName(me.name);
    initializedRef.current = true;
  }, [me]);

  function updateMyField(updates) {
    if (!room || !user) return;
    const updated = room.players.map(p =>
      p.uid === user.uid ? { ...p, ...updates } : p
    );
    updateDoc(doc(db, 'rooms', roomId), {
      players: updated,
      updatedAt: serverTimestamp(),
    }).catch(err => console.error(err));
  }

  function handleNameBlur() {
    const name = myName.trim() || me?.name || 'Player';
    setMyName(name);
    updateMyField({ name });
  }

  function handleColorChange(color) {
    const takenByOthers = room.players.filter(p => p.uid !== user.uid).map(p => p.color);
    if (takenByOthers.includes(color)) return;
    updateMyField({ color });
  }

  async function handleStart() {
    await updateDoc(doc(db, 'rooms', roomId), {
      status: 'active',
      updatedAt: serverTimestamp(),
    });
  }

  if (loading || !room) return <div className="page lobby-room-page"><p style={{ padding: 20 }}>...</p></div>;

  const isHost          = room.hostUid === user?.uid;
  const canStart        = isHost && room.players.length >= 2;
  const takenByOthers   = new Set(room.players.filter(p => p.uid !== user?.uid).map(p => p.color));
  const otherPlayers    = room.players.filter(p => p.uid !== user?.uid);

  return (
    <div className="page lobby-room-page">
      <div className="lobby-header">
        <button className="btn btn-ghost setup-back-btn" onClick={() => setShowLeaveConfirm(true)}>←</button>
        <div style={{ display: 'flex', gap: '2px' }}>
          <button className="btn btn-ghost menu-theme-btn" onClick={() => setLanguage(lang === 'hr' ? 'en' : 'hr')}>
            {lang.toUpperCase()}
          </button>
          <button className="btn btn-ghost menu-theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
        </div>
      </div>

      <div className="lobby-room-content">
        <div className="lobby-code-display">
          <h2>{t('lobbyRoomCode')}</h2>
          <div className="lobby-code-value">{room.code}</div>
          <p className="lobby-code-hint">{t('lobbyShareCode')}</p>
        </div>

        {/* My editable player card */}
        {me && (
          <div>
            <p className="lobby-players-title">{t('lobbyYou')}</p>
            <div className="player-card card">
              <div className="player-card-top">
                <div className="player-avatar" style={{ backgroundColor: COLOR_HEX[me.color] }}>
                  {myName.charAt(0).toUpperCase() || '?'}
                </div>
                <input
                  className="player-name-input"
                  value={myName}
                  maxLength={14}
                  onChange={e => setMyName(e.target.value)}
                  onBlur={handleNameBlur}
                />
              </div>
              <div className="player-colors">
                {PLAYER_ORDER.map(color => (
                  <button
                    key={color}
                    className={`color-dot ${me.color === color ? 'color-dot--active' : ''} ${takenByOthers.has(color) ? 'color-dot--taken' : ''}`}
                    style={{ backgroundColor: COLOR_HEX[color] }}
                    onClick={() => handleColorChange(color)}
                    disabled={takenByOthers.has(color)}
                    aria-label={color}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Other players — read-only */}
        {otherPlayers.length > 0 && (
          <div>
            <p className="lobby-players-title">{t('lobbyPlayers')}</p>
            <div className="lobby-players-list">
              {otherPlayers.map(p => (
                <div key={p.uid} className="lobby-player-row">
                  <span className="lobby-player-dot" style={{ background: COLOR_HEX[p.color] }} />
                  <span className="lobby-player-name">
                    {p.name}
                    {p.uid === room.hostUid ? ' 👑' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="lobby-error">{error}</p>}

        {canStart && (
          <button className="btn btn-primary btn-lg" onClick={handleStart}>
            🎮 {t('setupStart')}
          </button>
        )}
        {isHost && !canStart && (
          <p className="lobby-status-msg">{t('lobbyWaitingPlayers')}</p>
        )}
        {!isHost && (
          <p className="lobby-status-msg">{t('lobbyWaitingHost')}</p>
        )}
      </div>

      {showLeaveConfirm && (
        <Modal title={t('lobbyLeaveTitle')}>
          <p style={{ textAlign: 'center' }}>{t('lobbyLeaveMsg')}</p>
          <button className="btn btn-danger" onClick={() => navigate('/lobby')}>{t('lobbyLeaveYes')}</button>
          <button className="btn btn-secondary" onClick={() => setShowLeaveConfirm(false)}>{t('lobbyLeaveNo')}</button>
        </Modal>
      )}
    </div>
  );
}