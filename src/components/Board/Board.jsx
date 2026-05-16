import { useState } from 'react';
import { GRID, PLAYERS, OUTER_PATH, INNER_PATH, getBridgeParallel } from '../../data/boardLayout.js';
import './Board.css';

const CENTER_PIPS = {
  1: [[50,50]],
  2: [[25,25],[75,75]],
  3: [[25,25],[50,50],[75,75]],
  4: [[25,25],[75,25],[25,75],[75,75]],
  5: [[25,25],[75,25],[50,50],[25,75],[75,75]],
  6: [[25,22],[75,22],[25,50],[75,50],[25,78],[75,78]],
};

function CenterDie({ value, onRoll, disabled, rollsLeft, showRollCount }) {
  const [rolling, setRolling] = useState(false);

  function handleRoll() {
    if (disabled || rolling) return;
    setRolling(true);
    setTimeout(() => setRolling(false), 600);
    onRoll?.();
  }

  return (
    <div className="board-dice-overlay">
      <div
        className={`center-die${value ? ' center-die--has-value' : ''}${!disabled ? ' center-die--active' : ''}${rolling ? ' center-die--rolling' : ''}`}
        onClick={handleRoll}
      >
        {value
          ? CENTER_PIPS[value]?.map(([x, y], i) => (
              <div key={i} className="center-die-pip" style={{ left: `${x}%`, top: `${y}%` }} />
            ))
          : <span className="center-die-label">🎲</span>
        }
      </div>
      {!disabled && showRollCount && (
        <span className="center-die-rolls">{rollsLeft}×</span>
      )}
    </div>
  );
}

const SPECIAL_ICONS = {
  most:    '🌉',
  kocka:   '🎲',
  rewind:  '⏪',
  bomba:   '💣',
  stop:    '⏸️',
  zamjena: '🔄',
};

const COLOR_HEX = {
  red: '#e53935', yellow: '#fdd835', blue: '#1e88e5', green: '#43a047',
  cyan: '#00838f', purple: '#8e24aa', magenta: '#f06292', orange: '#fb8c00',
};

function getArrowDir(path, idx) {
  const curr = path[idx];
  const next = path[(idx + 1) % path.length];
  if (next.r > curr.r) return '↓';
  if (next.r < curr.r) return '↑';
  if (next.c > curr.c) return '→';
  return '←';
}

function buildSpawnMap(activePlayers) {
  const map = {};
  activePlayers.forEach(player => {
    const pd = PLAYERS[player.color];
    if (!pd) return;
    const outerCell = OUTER_PATH[pd.exitOuter];
    map[`${outerCell.r}-${outerCell.c}`] = { color: player.color, dir: getArrowDir(OUTER_PATH, pd.exitOuter) };
    const innerCell = INNER_PATH[pd.exitInner];
    map[`${innerCell.r}-${innerCell.c}`] = { color: player.color, dir: getArrowDir(INNER_PATH, pd.exitInner) };
  });
  return map;
}

function getFiguresOnCell(ring, idx, allPlayers) {
  if (!Array.isArray(allPlayers)) return [];
  const result = [];
  allPlayers.forEach(player => {
    player.figures.forEach(fig => {
      if (typeof fig.pos === 'object' && fig.pos.ring === ring && fig.pos.idx === idx) {
        result.push({ ...fig, playerColor: player.color });
      }
    });
  });
  return result;
}

function getFiguresOnFinish(allPlayers, colorKey, lane, slot) {
  if (!Array.isArray(allPlayers)) return [];
  const result = [];
  allPlayers.forEach(player => {
    player.figures.forEach(fig => {
      if (
        typeof fig.pos === 'object' &&
        fig.pos.lane === lane &&
        fig.pos.color === colorKey &&
        fig.pos.slot === slot
      ) {
        result.push({ ...fig, playerColor: player.color });
      }
    });
  });
  return result;
}


function BridgeOverlay({ bridgesOnBoard }) {
  const bridges = Object.entries(bridgesOnBoard || {})
    .flatMap(([key]) => {
      const parts = key.split('-');
      const ring = parts[0];
      const idx = Number(parts[1]);
      const path = ring === 'outer' ? OUTER_PATH : INNER_PATH;
      const { r: r1, c: c1 } = path[idx];
      const dest = getBridgeParallel(ring, idx);
      if (!dest) return [];
      const path2 = dest.ring === 'outer' ? OUTER_PATH : INNER_PATH;
      const { r: r2, c: c2 } = path2[dest.idx];

      // Draw edge-to-edge so the line only spans the margin, not over the cells
      let ex1, ey1, ex2, ey2;
      if (r1 !== r2) {
        ex1 = c1 + 0.5; ex2 = c2 + 0.5;
        ey1 = r1 < r2 ? r1 + 1 : r1;
        ey2 = r2 < r1 ? r2 + 1 : r2;
      } else {
        ey1 = r1 + 0.5; ey2 = r2 + 0.5;
        ex1 = c1 < c2 ? c1 + 1 : c1;
        ex2 = c2 < c1 ? c2 + 1 : c2;
      }

      return [{ x1: ex1, y1: ey1, x2: ex2, y2: ey2, key }];
    });

  if (!bridges.length) return null;

  return (
    <svg
      className="bridge-overlay"
      viewBox="0 0 19 19"
      preserveAspectRatio="none"
    >
      {bridges.map(({ x1, y1, x2, y2, key }) => (
        <g key={key}>
          <line x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="#7a4a10" strokeWidth="0.55" strokeLinecap="butt" opacity="0.9" />
          <line x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="#f5c842" strokeWidth="0.22" strokeLinecap="butt"
            strokeDasharray="0.35 0.25" opacity="0.9" />
        </g>
      ))}
    </svg>
  );
}

function Figure({ playerColor, figId, isMoveable, isStop, isRewind, isBomb, onClick }) {
  const extra = isStop ? ' figure--stop' : isRewind ? ' figure--rewind' : isBomb ? ' figure--bomb' : '';
  return (
    <div
      className={`figure${isMoveable ? ' figure--moveable' : ''}${extra}`}
      style={{ backgroundColor: COLOR_HEX[playerColor] }}
      onClick={onClick}
      title={`${playerColor} #${figId}${isStop ? ' ⏸️' : isRewind ? ' ⏪' : isBomb ? ' 💣' : ''}`}
    />
  );
}

export default function Board({
  gamePlayers,
  specialsOnBoard,
  bridgesOnBoard,
  moveableFigures,
  validTargets,
  onFigureClick,
  onCellClick,
  onRoll,
  diceValue,
  diceDisabled,
  rollsLeft,
  showRollCount,
}) {
  const players = Array.isArray(gamePlayers) ? gamePlayers : [];
  const spawnMap = buildSpawnMap(players);

  function renderFigures(figures, isHome = false) {
    if (!figures.length) return null;
    return (
      <div className={`figures-group ${isHome ? 'figures-group--home' : ''}`}>
        {figures.map((fig) => {
          const isMoveable = moveableFigures?.some(
            m => m.figId === fig.id && m.playerColor === fig.playerColor
          );
          return (
            <Figure
              key={`${fig.playerColor}-${fig.id}`}
              playerColor={fig.playerColor}
              figId={fig.id}
              isMoveable={isMoveable}
              isStop={!!fig.stopActive}
              isRewind={!!fig.rewindNext}
              isBomb={!!fig.bombActive}
              onClick={() => onFigureClick?.(fig.playerColor, fig.id)}
            />
          );
        })}
      </div>
    );
  }

  const cells = [];
  for (let r = 0; r < 19; r++) {
    for (let c = 0; c < 19; c++) {
      const cell = GRID[r][c];
      const key = `${r}-${c}`;
      let className = `board-cell board-cell--${cell.type}`;
      if (cell.color) className += ` board-cell--${cell.color}`;

      const spawn = spawnMap[key];
      let content = null;
      let specialIcon = null;
      let specialBadge = false;

      if (cell.type === 'outer-path') {
        const spKey = `outer-${cell.outerIdx}`;
        const figs = getFiguresOnCell('outer', cell.outerIdx, players);
        // Non-bridge special takes priority for the icon; bridge shown on parallel cell too
        if (specialsOnBoard?.[spKey]) {
          specialIcon = SPECIAL_ICONS[specialsOnBoard[spKey].type];
          specialBadge = figs.length > 0;
        } else {
          const hasBridge = bridgesOnBoard?.[spKey];
          const dest = getBridgeParallel('outer', cell.outerIdx);
          const parallelHasBridge = dest && bridgesOnBoard?.[`${dest.ring}-${dest.idx}`];
          if (hasBridge || parallelHasBridge) {
            specialIcon = SPECIAL_ICONS['most'];
            specialBadge = figs.length > 0;
          }
        }
        const isTarget = validTargets?.some(t => t.ring === 'outer' && t.idx === cell.outerIdx);
        if (isTarget) className += ' board-cell--target';
        content = renderFigures(figs);
      } else if (cell.type === 'inner-path') {
        const spKey = `inner-${cell.innerIdx}`;
        const figs = getFiguresOnCell('inner', cell.innerIdx, players);
        if (specialsOnBoard?.[spKey]) {
          specialIcon = SPECIAL_ICONS[specialsOnBoard[spKey].type];
          specialBadge = figs.length > 0;
        } else {
          const hasBridge = bridgesOnBoard?.[spKey];
          const dest = getBridgeParallel('inner', cell.innerIdx);
          const parallelHasBridge = dest && bridgesOnBoard?.[`${dest.ring}-${dest.idx}`];
          if (hasBridge || parallelHasBridge) {
            specialIcon = SPECIAL_ICONS['most'];
            specialBadge = figs.length > 0;
          }
        }
        const isTarget = validTargets?.some(t => t.ring === 'inner' && t.idx === cell.innerIdx);
        if (isTarget) className += ' board-cell--target';
        content = renderFigures(figs);
      } else if (cell.type === 'home') {
        const player = players.find(p => p.color === cell.color);
        if (player) {
          const fig = player.figures[cell.homeSlot];
          if (fig && fig.pos === 'home') {
            content = renderFigures([{ ...fig, playerColor: cell.color }], true);
          }
        }
      } else if (cell.type === 'finish') {
        const figs = getFiguresOnFinish(players, cell.color, 'finish', cell.slot);
        const figsMapped = figs.map(f => ({ ...f, playerColor: cell.color }));
        const isTarget = validTargets?.some(
          t => t.lane === 'finish' && t.color === cell.color && t.slot === cell.slot
        );
        if (isTarget) className += ' board-cell--target';
        content = (
          <>
            {figs.length === 0 && <span className="finish-slot-num">{cell.slot}</span>}
            {renderFigures(figsMapped)}
          </>
        );
      }

      cells.push(
        <div
          key={key}
          className={className}
          style={spawn ? { backgroundColor: COLOR_HEX[spawn.color] + '55' } : undefined}
          onClick={() => onCellClick?.({ r, c, cell })}
          data-r={r}
          data-c={c}
        >
          {spawn && (
            <span className="spawn-arrow" style={{ color: COLOR_HEX[spawn.color] }}>
              {spawn.dir}
            </span>
          )}
          {specialIcon && (
            <span className={`special-icon${specialBadge ? ' special-icon--badge' : ''}`}>
              {specialIcon}
            </span>
          )}
          {content}
        </div>
      );
    }
  }

  return (
    <div className="board-wrapper">
      <div className="board-grid">
        {cells}
        <BridgeOverlay bridgesOnBoard={bridgesOnBoard} />
      </div>
      {onRoll && (
        <CenterDie
          value={diceValue}
          onRoll={onRoll}
          disabled={diceDisabled}
          rollsLeft={rollsLeft}
          showRollCount={showRollCount}
        />
      )}
    </div>
  );
}