import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { PLAYER_ORDER } from '../data/boardLayout';
import './GameSetup.css';

const ALL_COLORS = PLAYER_ORDER; // red, yellow, blue, magenta, orange, purple, cyan, green

const COLOR_HEX = {
  red: '#e53935', yellow: '#fdd835', blue: '#1e88e5', green: '#43a047',
  cyan: '#00838f', purple: '#8e24aa', magenta: '#f06292', orange: '#fb8c00',
};

const MAX_NAME_LEN = 14;

// Build `count` players, keeping the name+color of any player that survives the
// new count and filling the rest with the first still-unused colors.
function initPlayers(count, label, prev = []) {
  const kept = prev.slice(0, count);
  const used = new Set(kept.map(p => p.color));
  const free = ALL_COLORS.filter(c => !used.has(c));
  let f = 0;
  return Array.from({ length: count }, (_, i) => kept[i]
    ? { ...kept[i], id: i }
    : { id: i, name: `${label} ${i + 1}`, color: free[f++] });
}

// After a finished offline game, "Play again" lands back here — pre-fill the
// names and colors the players just used. Returns null on anything unusable so
// we fall back to the defaults.
function loadPreviousPlayers() {
  try {
    const raw = sessionStorage.getItem('gameSetup');
    if (!raw) return null;
    const saved = JSON.parse(raw)?.players;
    if (!Array.isArray(saved) || saved.length < 2 || saved.length > ALL_COLORS.length) return null;
    const seen = new Set();
    const players = saved.map((p, i) => {
      if (typeof p?.name !== 'string' || !ALL_COLORS.includes(p?.color) || seen.has(p.color)) return null;
      seen.add(p.color);
      return { id: i, name: p.name.slice(0, MAX_NAME_LEN), color: p.color };
    });
    return players.every(Boolean) ? players : null;
  } catch { return null; }
}

export default function GameSetup() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [initialPlayers] = useState(() => loadPreviousPlayers() ?? initPlayers(4, t('setupPlayerName')));
  const [count, setCount] = useState(initialPlayers.length);
  const [players, setPlayers] = useState(initialPlayers);

  function handleCountChange(n) {
    setCount(n);
    // keep custom names and colors of the players that remain
    setPlayers(prev => initPlayers(n, t('setupPlayerName'), prev));
  }

  function handleName(id, name) {
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  }

  function handleColor(id, color) {
    const already = players.find(p => p.id !== id && p.color === color);
    if (already) return; // color taken
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, color } : p));
  }

  function startGame() {
    sessionStorage.setItem('gameSetup', JSON.stringify({ players }));
    navigate('/game');
  }

  const usedColors = new Set(players.map(p => p.color));

  return (
    <div className="setup-page page">
      <div className="setup-header">
        <button className="btn btn-ghost setup-back-btn" onClick={() => navigate('/')}>←</button>
        <h2 className="setup-title">{t('setupTitle')}</h2>
        <div className="setup-header-actions">
          <button className="btn btn-ghost menu-theme-btn" onClick={() => navigate('/rules')} aria-label={t('menuRules')}>
            📖
          </button>
          <button className="btn btn-ghost menu-theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? '🌙' : '🔅'}
          </button>
        </div>
      </div>

      <div className="setup-scroll">
        <div className="setup-count-row">
          <span className="setup-label">{t('setupPlayers')}</span>
          <div className="setup-count-btns">
            {[2,3,4,5,6,7,8].map(n => (
              <button
                key={n}
                className={`count-btn ${count === n ? 'count-btn--active' : ''}`}
                onClick={() => handleCountChange(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="setup-players">
          {players.map(player => (
            <div key={player.id} className="player-card card">
              <div className="player-card-top">
                <div className="player-avatar" style={{ backgroundColor: COLOR_HEX[player.color] }}>
                  {player.name.charAt(0).toUpperCase()}
                </div>
                <input
                  className="player-name-input"
                  value={player.name}
                  maxLength={MAX_NAME_LEN}
                  onChange={e => handleName(player.id, e.target.value)}
                />
              </div>
              <div className="player-colors">
                {ALL_COLORS.map(color => (
                  <button
                    key={color}
                    className={`color-dot ${player.color === color ? 'color-dot--active' : ''} ${usedColors.has(color) && player.color !== color ? 'color-dot--taken' : ''}`}
                    style={{ backgroundColor: COLOR_HEX[color] }}
                    onClick={() => handleColor(player.id, color)}
                    aria-label={t('color' + color.charAt(0).toUpperCase() + color.slice(1))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="setup-footer">
        <button className="btn btn-primary setup-start-btn" onClick={startGame}>
          🎮 {t('setupStart')}
        </button>
      </div>
    </div>
  );
}