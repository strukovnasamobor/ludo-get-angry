import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { PLAYER_ORDER } from '../data/boardLayout';
import './Lobby.css';


function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function Lobby() {
  const navigate = useNavigate();
  const { user, loading, signInWithGoogle, signOut, redirectError } = useAuth();
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [joinCode, setJoinCode]       = useState('');
  const [error, setError]             = useState('');
  const [busy, setBusy]               = useState(false);
  const [signInError, setSignInError] = useState('');

  function handleSignInClick() {
    setSignInError('');
    signInWithGoogle().catch(err => setSignInError(err?.message || 'sign-in failed'));
  }

  if (loading) return <div className="page lobby-page"><p>...</p></div>;

  if (!db) {
    return (
      <div className="page lobby-page">
        <div className="lobby-header">
          <button className="btn btn-ghost setup-back-btn" onClick={() => navigate('/')}>←</button>
        </div>
        <div className="lobby-content">
          <h2 className="lobby-title">{t('menuMultiplayer')}</h2>
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6 }}>
            Firebase is not configured yet.<br />
            Fill in <code>.env</code> with your Firebase project credentials to enable multiplayer.
          </p>
        </div>
      </div>
    );
  }

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      const code = generateCode();
      const name = user.displayName || user.email?.split('@')[0] || t('setupPlayerName');
      const docRef = await addDoc(collection(db, 'rooms'), {
        code,
        hostUid: user.uid,
        status: 'waiting',
        players: [{ uid: user.uid, name, color: PLAYER_ORDER[0], index: 0 }],
        playerUids: [user.uid],
        gameState: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      navigate(`/lobby/${docRef.id}`);
    } catch (err) {
      console.error(err);
      setError(t('lobbyCreateError'));
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) { setError('Enter a 6-character room code.'); return; }
    setBusy(true);
    setError('');
    try {
      const q = query(
        collection(db, 'rooms'),
        where('code', '==', code),
        where('status', '==', 'waiting'),
      );
      const snap = await getDocs(q);
      if (snap.empty) { setError('Room not found or already started.'); setBusy(false); return; }
      navigate(`/lobby/${snap.docs[0].id}`);
    } catch (err) {
      console.error(err);
      setError(t('lobbyJoinError'));
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div className="lobby-header">
      <button className="btn btn-ghost setup-back-btn" onClick={() => navigate('/')}>←</button>
      <div style={{ display: 'flex', gap: '2px' }}>
        <button className="btn btn-ghost menu-theme-btn" onClick={() => navigate('/rules')} aria-label={t('menuRules')}>
          📖
        </button>
        <button className="btn btn-ghost menu-theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'dark' ? '🌙' : '🔅'}
        </button>
      </div>
    </div>
  );

  if (!user) {
    return (
      <div className="page lobby-page">
        {header}
        <div className="lobby-content">
          <h2 className="lobby-title">{t('menuMultiplayer')}</h2>
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '24px' }}>
            {t('lobbySignInPrompt')}
          </p>
          <button className="btn btn-primary btn-lg lobby-google-btn" onClick={handleSignInClick}>
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" width="20" height="20" />
            {t('lobbySignInGoogle')}
          </button>
          {(signInError || redirectError) && (
            <p className="lobby-error" style={{ marginTop: '12px' }}>{signInError || redirectError}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page lobby-page">
      {header}

      <div className="lobby-content">
        <h2 className="lobby-title">{t('menuMultiplayer')}</h2>

        <div className="lobby-user-row">
          {user.photoURL && <img src={user.photoURL} alt="" className="lobby-user-avatar" referrerPolicy="no-referrer" />}
          <span className="lobby-user-name">{user.displayName || user.email}</span>
          <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={signOut}>
            {t('lobbySignOut')}
          </button>
        </div>

        <section className="lobby-section">
          <h3 className="lobby-section-title">{t('lobbyCreate')}</h3>
          <button className="btn btn-primary btn-lg" onClick={handleCreate} disabled={busy}>
            {t('lobbyCreateBtn')}
          </button>
        </section>

        <div className="lobby-divider">{t('lobbyOr')}</div>

        <section className="lobby-section">
          <h3 className="lobby-section-title">{t('lobbyJoin')}</h3>
          <input
            className="player-name-input lobby-code-input"
            placeholder={t('lobbyCodePlaceholder')}
            value={joinCode}
            maxLength={6}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
          />
          <button
            className="btn btn-secondary btn-lg"
            onClick={handleJoin}
            disabled={busy || joinCode.length !== 6}
          >
            {t('lobbyJoinBtn')}
          </button>
        </section>

        {error && <p className="lobby-error">{error}</p>}
      </div>
    </div>
  );
}