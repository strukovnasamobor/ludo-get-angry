import './PlayerPanel.css';

const SPECIAL_ICONS = {
  most: '🌉', kocka: '🎲', rewind: '⏪', bomba: '💣', stop: '⏸️', zamjena: '🔄',
};

const SPECIAL_KEYS = {
  most: 'specialMost', kocka: 'specialKocka', rewind: 'specialRewind',
  bomba: 'specialBomba', stop: 'specialStop', zamjena: 'specialZamjena',
};

const COLOR_HEX = {
  red: '#e53935', yellow: '#fdd835', blue: '#1e88e5', green: '#43a047',
  cyan: '#00838f', purple: '#8e24aa', magenta: '#f06292', orange: '#fb8c00',
};

export default function PlayerPanel({
  players,
  currentPlayerIndex,
  phase,
  isMyTurn = true,
  onSelectSpecialForPlace,
  selectedSpecial,
  placeableSpecials,
  hasPickup,
  onPickup,
  t,
}) {
  const isSixAction = phase === 'six-action';
  const isMoving = phase === 'moving';
  const placeable = placeableSpecials || new Set();
  const current = players[currentPlayerIndex];

  // Tally figure positions for current player
  const atHome = current.figures.filter(f => f.pos === 'home').length;
  const onBoard = current.figures.filter(f => typeof f.pos === 'object' && f.pos.ring).length;
  const inFinish = current.figures.filter(f => typeof f.pos === 'object' && f.pos.lane).length;

  // Unique specials for display (grouped)
  const specialCounts = {};
  current.specialsHeld.forEach(s => {
    specialCounts[s] = (specialCounts[s] || 0) + 1;
  });

  return (
    <div className="player-panel">
      {/* Current player row */}
      <div className="panel-current">
        <div className="panel-center-group">
          <div
            className="panel-avatar"
            style={{ backgroundColor: COLOR_HEX[current.color] }}
          >
            {current.name.charAt(0).toUpperCase()}
          </div>
          <div className="panel-info">
            <span className="panel-name">{current.name}</span>
            <span className="panel-status">
              🏠{atHome} · 🎯{onBoard} · 🏁{inFinish}
            </span>
          </div>
        </div>
        {(() => {
          const showPickup = isMyTurn && (isMoving || isSixAction) && hasPickup;
          return (
            <div
              className="panel-place-actions"
              style={{ visibility: showPickup ? 'visible' : 'hidden', pointerEvents: showPickup ? 'auto' : 'none' }}
            >
              <button
                className="panel-action-btn panel-action-btn--pickup"
                onClick={onPickup}
              >⬆</button>
            </div>
          );
        })()}
      </div>

      {/* Specials in hand — clickable to place ONLY during six-action (a 6 was rolled). */}
      <div className="panel-specials">
        {Object.entries(specialCounts).map(([type, count]) => {
          const canPlace = isSixAction && placeable.has(type);
          const isDisabled = !isSixAction || !canPlace;
          return (
            <button
              key={type}
              className={`special-chip ${selectedSpecial === type ? 'special-chip--selected' : ''} ${isSixAction ? 'special-chip--active' : ''} ${isDisabled ? 'special-chip--disabled' : ''}`}
              onClick={() => { if (canPlace && isMyTurn) onSelectSpecialForPlace?.(type); }}
              title={isDisabled ? t('mostCannotField') : t(SPECIAL_KEYS[type])}
            >
              {SPECIAL_ICONS[type]}{count > 1 ? <span className="special-chip-count">×{count}</span> : ''}
            </button>
          );
        })}
      </div>

      {/* All players strip */}
      <div className="panel-players-strip">
        {players.map((p, i) => (
          <div
            key={p.color}
            className={`strip-player ${i === currentPlayerIndex ? 'strip-player--active' : ''}`}
            style={{ '--pcolor': COLOR_HEX[p.color] }}
          >
            <div className="strip-dot" style={{ backgroundColor: COLOR_HEX[p.color] }} />
            <span className="strip-finish">{p.figures.filter(f => typeof f.pos === 'object' && f.pos.lane).length}/4</span>
          </div>
        ))}
      </div>
    </div>
  );
}