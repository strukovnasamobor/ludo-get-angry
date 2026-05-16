import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useGame } from '../hooks/useGame.js';
import { usePinchZoom } from '../hooks/usePinchZoom.js';
import { canPlaceMost, OUTER_PATH, INNER_PATH, PLAYERS } from '../data/boardLayout.js';
import Board from '../components/Board/Board.jsx';
import PlayerPanel from '../components/PlayerPanel.jsx';
import Modal from '../components/Modal.jsx';
import './GameBoard.css';

const COLOR_HEX = {
  red: '#e53935', yellow: '#fdd835', blue: '#1e88e5', green: '#43a047',
  cyan: '#00838f', purple: '#8e24aa', magenta: '#f06292', orange: '#fb8c00',
};

function loadSetup() {
  try {
    const raw = sessionStorage.getItem('gameSetup');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function GameBoard({ gameHook = null, isMyTurn = true, myPlayerColor = null, playAgainPath = '/setup', isHost = true }) {
  const navigate = useNavigate();
  const { t, lang, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const setup = loadSetup();
  useEffect(() => {
    if (!gameHook && !setup) navigate('/setup');
  }, []);

  const localHook = useGame(setup?.players || []);
  const { state, currentPlayer, validMoves, rollDice, selectMove,
    skipPlaceSpecial, placeSpecial, resolveDuel, duelSetRoll, resolveMost, resolveKocka, kockaSetRoll, resolveZamjena,
    dismissSpecialInfo, endTurn, initialRoll, continueAfterTie, startGame,
  } = gameHook ?? localHook;

  const { containerRef: boardAreaRef, transform: boardTransform } = usePinchZoom();

  const [selectedSpecialType, setSelectedSpecialType] = useState(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [inStuckRolls, setInStuckRolls] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const autoAdvanceRef = useRef(null);

  // Derived
  const phase = state.phase;
  const isInitialRoll = phase === 'initial-roll';
  const isRolling = phase === 'rolling';
  const isMoving = phase === 'moving';
  const isPlacing = phase === 'placing-special';
  const isDuel = phase === 'duel';
  const isSpecial = phase === 'special-trigger';
  const isOver = phase === 'game-over';
  const isNoMoves = phase === 'no-moves';

  // Whether MOST can be placed at the current landed cell
  const mostCanPlace = isPlacing && state.lastMoveRing
    ? !!canPlaceMost(state.lastMoveRing, state.lastMoveIdx, state.bridgesOnBoard)
    : true;

  // Spawn points only allow bridge placement
  const isSpawnPointLanding = isPlacing && state.lastMoveRing != null
    ? state.players.some(p => {
        const pd = PLAYERS[p.color];
        return pd && (
          (state.lastMoveRing === 'outer' && state.lastMoveIdx === pd.exitOuter) ||
          (state.lastMoveRing === 'inner' && state.lastMoveIdx === pd.exitInner)
        );
      })
    : false;

  // Track when player is in stuck 3-roll mode
  useEffect(() => {
    if (state.rollsLeft === 3) setInStuckRolls(true);
    if (!isRolling) setInStuckRolls(false);
  }, [state.rollsLeft, isRolling]);

  // Keep auto-advance ref current so interval closure always calls latest callbacks
  autoAdvanceRef.current = () => {
    if (!isMyTurn) return;
    if (phase === 'placing-special') skipPlaceSpecial();
    else if (phase === 'rolling' || phase === 'moving') endTurn();
    else if (phase === 'special-trigger') {
      const tr = state.specialTrigger;
      if (tr?.type === 'kocka' && tr.d1 == null) {
        kockaSetRoll(Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1);
      } else if (tr?.type === 'zamjena') {
        if (zamjenaEligibleFigs.length > 0) {
          const pick = zamjenaEligibleFigs[Math.floor(Math.random() * zamjenaEligibleFigs.length)];
          resolveZamjena(tr, pick.playerColor, pick.figId);
        } else {
          resolveZamjena(tr, null, null);
        }
      } else if (tr?.type !== 'kocka') {
        dismissSpecialInfo();
      }
    }
    else if (phase === 'duel') {
      const ds = state.duelState;
      if (!ds) return;
      const canRollAtk = (!myPlayerColor || myPlayerColor === ds.atkColor) && ds.atkRoll === null;
      const canRollDef = (!myPlayerColor || myPlayerColor === ds.defColor) && ds.defRoll === null;
      if (canRollAtk) duelSetRoll('atk', Math.floor(Math.random() * 6) + 1);
      else if (canRollDef) duelSetRoll('def', Math.floor(Math.random() * 6) + 1);
    }
  };

  // Reset and start 30s countdown whenever a meaningful state change occurs
  const stateKey = `${state.currentPlayerIndex}-${phase}-${state.diceValue}-${state.rollsLeft}-${state.duelState?.atkRoll ?? ''}-${state.duelState?.defRoll ?? ''}-${state.specialTrigger?.d1 ?? ''}`;
  useEffect(() => {
    if (isOver || isInitialRoll) return;
    setTimeLeft(30);
    const id = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { autoAdvanceRef.current?.(); return 30; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [stateKey, isOver, isInitialRoll]);

  // Auto-advance after showing the dice result when there are no valid moves
  useEffect(() => {
    if (!isNoMoves) return;
    const timer = setTimeout(endTurn, 1500);
    return () => clearTimeout(timer);
  }, [isNoMoves, endTurn]);

  // Auto-dismiss "own zamjena" info after 2.5s
  useEffect(() => {
    if (!isSpecial || state.specialTrigger?.type !== 'zamjena-own') return;
    const id = setTimeout(dismissSpecialInfo, 2500);
    return () => clearTimeout(id);
  }, [isSpecial, state.specialTrigger?.type]);

  // Show both duel rolls for 1.5s before resolving — only the attacker (isMyTurn) dispatches
  const ds = state.duelState;
  useEffect(() => {
    if (!ds || ds.atkRoll === null || ds.defRoll === null || !isMyTurn) return;
    const id = setTimeout(() => resolveDuel(ds.atkRoll, ds.defRoll), 1500);
    return () => clearTimeout(id);
  }, [ds?.atkRoll, ds?.defRoll, isMyTurn]);

  const isZamjena = isSpecial && state.specialTrigger?.type === 'zamjena';
  const zamjenaPlacer = isZamjena
    ? state.players.find(p => p.color === state.specialTrigger.placedBy && p.color !== state.specialTrigger.playerColor)
    : null;
  const zamjenaEligibleFigs = zamjenaPlacer
    ? zamjenaPlacer.figures
        .filter(f => typeof f.pos === 'object' && f.pos.ring
          && !(f.pos.ring === state.specialTrigger.ring && f.pos.idx === state.specialTrigger.idx))
        .map(f => {
          const path = f.pos.ring === 'outer' ? OUTER_PATH : INNER_PATH;
          const cell = path[f.pos.idx];
          return { figId: f.id, playerColor: zamjenaPlacer.color, row: cell.r + 1, col: cell.c + 1 };
        })
    : [];

  const moveableFigures = isMoving
    ? validMoves.map(m => ({ figId: m.figId, playerColor: currentPlayer.color }))
    : isZamjena
      ? zamjenaEligibleFigs
      : [];

  const validTargets = isMoving
    ? validMoves.filter(m => m.type !== 'pickup' && m.type !== 'pickup-bridge').map(m => {
        if (m.type === 'move' || m.type === 'exit') return { ring: m.ring, idx: m.idx };
        if (m.type === 'finish') return { lane: m.lane, color: m.color, slot: m.slot };
        return null;
      }).filter(Boolean)
    : isPlacing && state.lastMoveRing
      ? [{ ring: state.lastMoveRing, idx: state.lastMoveIdx }]
      : [];

  function handleFigureClick(playerColor, figId) {
    if (!isMyTurn) return;
    if (isZamjena) {
      if (zamjenaEligibleFigs.some(f => f.figId === figId && f.playerColor === playerColor)) {
        resolveZamjena(state.specialTrigger, playerColor, figId);
      }
      return;
    }
    if (!isMoving) return;
    if (playerColor !== currentPlayer.color) return;
    const figureMoves = validMoves.filter(m => m.figId === figId);
    if (figureMoves.length === 0) return;
    // Pickup-only figures are handled by the pickup button, not by clicking
    const nonPickupMoves = figureMoves.filter(m => m.type !== 'pickup' && m.type !== 'pickup-bridge');
    if (nonPickupMoves.length === 0) return;
    const move = nonPickupMoves[0];
    if (move.type === 'exit') {
      const exitMoves = figureMoves.filter(m => m.type === 'exit');
      if (exitMoves.length > 1) {
        setExitChoiceFig({ figId, playerColor, moves: exitMoves });
      } else {
        selectMove(move);
      }
      return;
    }
    // Both pickup and regular move available — don't auto-execute,
    // player clicks the highlighted target cell to choose
    if (figureMoves.some(m => m.type === 'pickup') && figureMoves.some(m => m.type === 'move')) return;
    selectMove(move);
  }

  const [exitChoiceFig, setExitChoiceFig] = useState(null);
  const [pickupChoiceMoves, setPickupChoiceMoves] = useState(null);

  const pickupMoves = isMoving ? validMoves.filter(m => m.type === 'pickup' || m.type === 'pickup-bridge') : [];
  const hasPickup = pickupMoves.length > 0;

  function handlePickupBtn() {
    if (!isMyTurn || !hasPickup) return;
    if (pickupMoves.length === 1) {
      selectMove(pickupMoves[0]);
    } else {
      setPickupChoiceMoves(pickupMoves);
    }
  }

  function handleCellClick({ cell }) {
    if (!isMyTurn) return;
    // Tap a target cell to select move
    if (isMoving) {
      if (cell.type === 'outer-path') {
        const move = validMoves.find(m => m.ring === 'outer' && m.idx === cell.outerIdx);
        if (move) selectMove(move);
      } else if (cell.type === 'inner-path') {
        const move = validMoves.find(m => m.ring === 'inner' && m.idx === cell.innerIdx);
        if (move) selectMove(move);
      } else if (cell.type === 'finish') {
        const move = validMoves.find(m => m.lane === 'finish' && m.color === cell.color && m.slot === cell.slot);
        if (move) selectMove(move);
      }
    }

  }

  function handleDuelRoll(who) {
    const ds = state.duelState;
    if (!ds) return;
    if (who === 'atk' && myPlayerColor && myPlayerColor !== ds.atkColor) return;
    if (who === 'def' && myPlayerColor && myPlayerColor !== ds.defColor) return;
    if (who === 'atk' && ds.atkRoll !== null) return;
    if (who === 'def' && ds.defRoll !== null) return;
    duelSetRoll(who, Math.floor(Math.random() * 6) + 1);
  }

  if (!gameHook && !setup) return null;

  return (
    <div className="gameboard-page page">
      {/* Top bar */}
      <div className="game-topbar">
        <button className="btn btn-ghost game-exit-btn" onClick={() => setShowExitConfirm(true)}>✕</button>
        <span className="game-turn-label" style={{ color: COLOR_HEX[currentPlayer.color] }}>
          {currentPlayer.name}
          {phase === 'rolling' && ' — 🎲'}
          {phase === 'moving' && ` — ${t('gamePhaseMoving')}`}
          {phase === 'placing-special' && ` — ${t('gamePhasePlacing')}`}
          {phase === 'duel' && ` — ${t('gamePhaseDuel')}`}
        </span>
        <div className="game-topbar-actions">
          <button className="btn btn-ghost menu-theme-btn" onClick={() => setLanguage(lang === 'hr' ? 'en' : 'hr')}>
            {lang.toUpperCase()}
          </button>
          <button className="btn btn-ghost menu-theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
        </div>
      </div>

      {/* Turn timer bar */}
      {!isOver && !isInitialRoll && (
        <div className="game-timer-track">
          <div
            className={`game-timer-bar ${timeLeft <= 7 ? 'game-timer-bar--urgent' : timeLeft <= 15 ? 'game-timer-bar--warning' : ''}`}
            style={{ width: `${(timeLeft / 30) * 100}%` }}
          />
        </div>
      )}

      {/* Board */}
      <div className="game-board-area" ref={boardAreaRef}>
        <div style={{
          transform: `translate(${boardTransform.x}px, ${boardTransform.y}px) scale(${boardTransform.scale})`,
          transformOrigin: 'center center',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          '--target-highlight': `${COLOR_HEX[currentPlayer.color]}66`,
        }}>
          <Board
            gamePlayers={state.players}
            specialsOnBoard={state.specialsOnBoard}
            bridgesOnBoard={state.bridgesOnBoard}
            moveableFigures={moveableFigures}
            validTargets={validTargets}
            onFigureClick={handleFigureClick}
            onCellClick={handleCellClick}
            currentPlayerColor={currentPlayer.color}
            onRoll={rollDice}
            diceValue={state.diceValue}
            diceDisabled={!isRolling || !isMyTurn}
            rollsLeft={state.rollsLeft}
            showRollCount={inStuckRolls}
          />
        </div>
      </div>

      {/* Bottom panel */}
      <div className="game-bottom">
        {isZamjena && (
          <ZamjenaStrip
            trigger={state.specialTrigger}
            placer={zamjenaPlacer}
            eligibleFigs={zamjenaEligibleFigs}
            players={state.players}
            isMyTurn={isMyTurn}
            onSelect={(targetColor, targetFigId) => resolveZamjena(state.specialTrigger, targetColor, targetFigId)}
            onSkip={() => resolveZamjena(state.specialTrigger, null, null)}
            t={t}
          />
        )}
        <PlayerPanel
          players={state.players}
          currentPlayerIndex={state.currentPlayerIndex}
          phase={phase}
          isMyTurn={isMyTurn}
          onSelectSpecialForPlace={type => {
            if (!isMyTurn) return;
            if (type === 'most' && !mostCanPlace) return;
            if (type !== 'most' && isSpawnPointLanding) return;
            setSelectedSpecialType(type === selectedSpecialType ? null : type);
          }}
          selectedSpecial={selectedSpecialType}
          mostCanPlace={mostCanPlace}
          spawnPointOnly={isSpawnPointLanding}
          hasPickup={hasPickup}
          onPickup={handlePickupBtn}
          onSkipPlaceSpecial={() => { if (!isMyTurn) return; setSelectedSpecialType(null); skipPlaceSpecial(); }}
          onConfirmPlaceSpecial={() => {
            if (!isMyTurn || !selectedSpecialType || !state.lastMoveRing) return;
            placeSpecial(state.lastMoveRing, state.lastMoveIdx, selectedSpecialType);
            setSelectedSpecialType(null);
          }}
          t={t}
        />
        <div className="game-controls">
          {isPlacing && selectedSpecialType === 'most' && !mostCanPlace && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', margin: '2px 0' }}>
              🌉 {t('mostCannotPlace')}
            </p>
          )}
          {isMoving && validMoves.length === 0 && isMyTurn && (
            <button className="btn btn-secondary" onClick={skipPlaceSpecial}>
              {t('gameNoMoves')} →
            </button>
          )}
        </div>
      </div>

      {/* Exit choice modal */}
      {exitChoiceFig && (
        <Modal title={t('gameChooseExit')} onClose={() => setExitChoiceFig(null)}>
          {exitChoiceFig.moves.map(m => (
            <button
              key={m.ring}
              className="btn btn-secondary"
              onClick={() => { selectMove(m); setExitChoiceFig(null); }}
            >
              {m.ring === 'outer' ? t('gameOuterRing') : t('gameInnerRing')}
            </button>
          ))}
        </Modal>
      )}

      {/* Pickup choice modal */}
      {pickupChoiceMoves && (() => {
        const SPECIAL_ICONS = { most: '🌉', kocka: '🎲', rewind: '⏪', bomba: '💣', stop: '⏸️', zamjena: '🔄' };
        const multiFig = new Set(pickupChoiceMoves.map(m => m.figId)).size > 1;
        return (
          <Modal title={t('pickupChoiceTitle')} onClose={() => setPickupChoiceMoves(null)}>
            {pickupChoiceMoves.map(m => {
              const spKey = `${m.ring}-${m.idx}`;
              const specialType = m.type === 'pickup' ? state.specialsOnBoard[spKey]?.type : null;
              const fieldLabel = m.type === 'pickup-bridge'
                ? `🌉 ${t('pickupBridge')}`
                : `${SPECIAL_ICONS[specialType] ?? '⭐'} ${t('pickupSpecial')}`;
              return (
                <button
                  key={`${m.figId}-${m.type}`}
                  className="btn btn-secondary"
                  onClick={() => { selectMove(m); setPickupChoiceMoves(null); }}
                >
                  {multiFig ? `${t('zamjenaFig')} ${m.figId + 1} — ${fieldLabel}` : fieldLabel}
                </button>
              );
            })}
          </Modal>
        );
      })()}

      {/* Duel modal */}
      {isDuel && state.duelState && (() => {
        const ds = state.duelState;
        const atkName = state.players.find(p => p.color === ds.atkColor)?.name;
        const defName = state.players.find(p => p.color === ds.defColor)?.name;
        const canRollAtk = !myPlayerColor || myPlayerColor === ds.atkColor;
        const canRollDef = !myPlayerColor || myPlayerColor === ds.defColor;
        return (
          <Modal title={t('duelTitle')}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <span style={{ color: COLOR_HEX[ds.atkColor] }}>●</span> {t('duelVs')}{' '}
              <span style={{ color: COLOR_HEX[ds.defColor] }}>●</span>
            </p>
            {ds.atkRoll === null && canRollAtk && (
              <button className="btn btn-primary" onClick={() => handleDuelRoll('atk')}>
                🎲 {atkName} {t('duelRoll')}
              </button>
            )}
            {ds.atkRoll === null && !canRollAtk && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>⏳ {atkName} {t('duelRoll')}…</p>
            )}
            {ds.atkRoll !== null && (
              <p>{t('duelAttacker')}: <strong>{ds.atkRoll}</strong></p>
            )}
            {ds.atkRoll !== null && ds.defRoll === null && canRollDef && (
              <button className="btn btn-primary" onClick={() => handleDuelRoll('def')}>
                🎲 {defName} {t('duelRoll')}
              </button>
            )}
            {ds.atkRoll !== null && ds.defRoll === null && !canRollDef && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>⏳ {defName} {t('duelRoll')}…</p>
            )}
            {ds.defRoll !== null && (
              <p>{t('duelDefender')}: <strong>{ds.defRoll}</strong></p>
            )}
          </Modal>
        );
      })()}

      {/* Special trigger modal — zamjena handled by the board strip below */}
      {isSpecial && state.specialTrigger && state.specialTrigger.type !== 'zamjena' && (
        <SpecialModal
          trigger={state.specialTrigger}
          players={state.players}
          t={t}
          isMyTurn={isMyTurn}
          onMost={cross => resolveMost(cross, state.specialTrigger)}
          onKockaSetRoll={(d1, d2) => kockaSetRoll(d1, d2)}
          onKocka={(d1, d2) => resolveKocka(state.specialTrigger, d1, d2)}
          onDismiss={dismissSpecialInfo}
        />
      )}

      {/* Initial roll modal — rule 2 */}
      {isInitialRoll && (
        <InitialRollModal
          state={state}
          players={state.players}
          onRoll={isMyTurn ? initialRoll : null}
          onContinue={isHost ? continueAfterTie : null}
          onStart={isHost ? startGame : null}
          t={t}
        />
      )}

      {/* Exit confirmation modal */}
      {showExitConfirm && (
        <Modal title={t('exitConfirmTitle')}>
          <p style={{ textAlign: 'center' }}>{t('exitConfirmMsg')}</p>
          <button className="btn btn-danger" onClick={() => navigate('/')}>{t('exitConfirmYes')}</button>
          <button className="btn btn-secondary" onClick={() => setShowExitConfirm(false)}>{t('exitConfirmNo')}</button>
        </Modal>
      )}

      {/* Win modal */}
      {isOver && state.winner && (
        <Modal title={t('gameWin')}>
          <p style={{ textAlign: 'center', fontSize: '2rem' }}>🏆</p>
          <p style={{ textAlign: 'center' }}>
            <strong style={{ color: COLOR_HEX[state.winner] }}>
              {state.players.find(p => p.color === state.winner)?.name}
            </strong>{' '}
            {t('gameWinMsg')}
          </p>
          <button className="btn btn-primary" onClick={() => navigate(playAgainPath)}>
            {t('gamePlayAgain')}
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            {t('gameMainMenu')}
          </button>
        </Modal>
      )}
    </div>
  );
}

const ZAMJENA_COLOR_HEX = {
  red: '#e53935', yellow: '#fdd835', blue: '#1e88e5', green: '#43a047',
  cyan: '#00838f', purple: '#8e24aa', magenta: '#f06292', orange: '#fb8c00',
};

function ZamjenaStrip({ trigger, placer, eligibleFigs, players, isMyTurn, onSelect, onSkip, t }) {
  const currentPlayer = players.find(p => p.color === trigger.playerColor);
  return (
    <div className="zamjena-strip">
      <div className="zamjena-strip-info">
        <span className="zamjena-strip-icon">🔄</span>
        <span className="zamjena-strip-label">{t('specialZamjena')}</span>
        {currentPlayer && !isMyTurn && (
          <span className="zamjena-strip-waiting">({currentPlayer.name})</span>
        )}
      </div>
      <div className="zamjena-strip-figs">
        {eligibleFigs.length === 0 && (
          <span className="zamjena-strip-empty">{t('zamjenaNoFigs')}</span>
        )}
        {eligibleFigs.map(f => (
          <button
            key={f.figId}
            className="zamjena-fig-btn"
            style={{ background: ZAMJENA_COLOR_HEX[f.playerColor] }}
            onClick={() => isMyTurn && onSelect(f.playerColor, f.figId)}
            disabled={!isMyTurn}
          >
            <span className="zamjena-fig-num">{f.figId + 1}</span>
            <span className="zamjena-fig-coord">{f.row},{f.col}</span>
          </button>
        ))}
      </div>
      {eligibleFigs.length === 0 && (
        <button
          className="btn btn-ghost zamjena-skip-btn"
          onClick={() => isMyTurn && onSkip()}
          disabled={!isMyTurn}
        >✕</button>
      )}
    </div>
  );
}

function KockaModal({ t, trigger, onKockaSetRoll, onKocka, isMyTurn = true }) {
  const rolled = trigger.d1 != null;

  // Once rolls are set in state (visible to all), active player resolves after a short delay
  useEffect(() => {
    if (!rolled || !isMyTurn) return;
    const id = setTimeout(() => onKocka(trigger.d1, trigger.d2), 1500);
    return () => clearTimeout(id);
  }, [rolled, isMyTurn]);

  function handleRoll() {
    if (!isMyTurn || rolled) return;
    onKockaSetRoll(
      Math.floor(Math.random() * 6) + 1,
      Math.floor(Math.random() * 6) + 1,
    );
  }

  return (
    <Modal title={`🎲 ${t('specialKocka')}`}>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('specialKockaMsg')}</p>
      {rolled ? (
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center', fontSize: '1.4rem', fontWeight: 900, margin: '8px 0' }}>
          <span>🎲 {trigger.d1}</span>
          <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>+</span>
          <span>🎲 {trigger.d2}</span>
          <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>=</span>
          <span style={{ color: 'var(--accent)' }}>{trigger.d1 + trigger.d2}</span>
        </div>
      ) : (
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleRoll} disabled={!isMyTurn}>
          🎲🎲 {t('gameRoll')}
        </button>
      )}
    </Modal>
  );
}

function SpecialModal({ trigger, t, isMyTurn = true, onMost, onKockaSetRoll, onKocka, onDismiss }) {
  if (trigger.type === 'stop') {
    return (
      <Modal title={`⏸️ ${t('specialStop')}`}>
        <p style={{ textAlign: 'center', fontSize: '0.95rem' }}>{t('specialStopMsg')}</p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDismiss} disabled={!isMyTurn}>{t('ok')}</button>
      </Modal>
    );
  }

  if (trigger.type === 'rewind') {
    return (
      <Modal title={`⏪ ${t('specialRewind')}`}>
        <p style={{ textAlign: 'center', fontSize: '0.95rem' }}>{t('specialRewindMsg')}</p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDismiss} disabled={!isMyTurn}>{t('ok')}</button>
      </Modal>
    );
  }

  if (trigger.type === 'bomba') {
    return (
      <Modal title={`💣 ${t('specialBomba')}`}>
        <p style={{ textAlign: 'center', fontSize: '0.95rem' }}>{t('specialBombaMsg')}</p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDismiss} disabled={!isMyTurn}>{t('ok')}</button>
      </Modal>
    );
  }

  if (trigger.type === 'most') {
    return (
      <Modal title={`🌉 ${t('specialMost')}`}>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('specialMostQ')}</p>
        <button className="btn btn-secondary" onClick={() => onMost(false)} disabled={!isMyTurn}>{t('specialMostStay')}</button>
        <button className="btn btn-primary" onClick={() => onMost(true)} disabled={!isMyTurn}>{t('specialMostCross')}</button>
      </Modal>
    );
  }

  if (trigger.type === 'kocka') {
    return <KockaModal key={`${trigger.ring}-${trigger.idx}`} t={t} trigger={trigger} onKockaSetRoll={onKockaSetRoll} onKocka={onKocka} isMyTurn={isMyTurn} />;
  }

  if (trigger.type === 'zamjena-own') {
    return (
      <Modal title={`🔄 ${t('specialZamjena')}`}>
        <p style={{ textAlign: 'center', fontSize: '0.95rem' }}>{t('zamjenaOwnField')}</p>
      </Modal>
    );
  }

  return null;
}

function InitialRollModal({ state, players, onRoll, onContinue, onStart, t }) {
  const COLOR_HEX = {
    red: '#e53935', yellow: '#fdd835', blue: '#1e88e5', green: '#43a047',
    cyan: '#00838f', purple: '#8e24aa', magenta: '#f06292', orange: '#fb8c00',
  };

  const { initialRollOrder, initialRolls, initialRollIdx, initialRollWinner, initialRollTied } = state;
  const allRolled = initialRollIdx >= initialRollOrder.length;
  const isReroll = initialRollOrder.length < players.length;
  const currentColor = !allRolled ? initialRollOrder[initialRollIdx] : null;
  const currentPlayer = currentColor ? players.find(p => p.color === currentColor) : null;
  const winner = initialRollWinner ? players.find(p => p.color === initialRollWinner) : null;

  return (
    <Modal title={`🎲 ${t('initialRollTitle')}`}>
      {isReroll && (
        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
          {t('initialRollTie')}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
        {initialRollOrder.map(color => {
          const player = players.find(p => p.color === color);
          const roll = initialRolls[color];
          const isCurrent = color === currentColor;
          const isMax = allRolled && roll === Math.max(...Object.values(initialRolls));
          return (
            <div
              key={color}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 14px',
                background: 'var(--bg-secondary)',
                borderRadius: '8px',
                border: `2px solid ${isCurrent ? COLOR_HEX[color] : isMax ? COLOR_HEX[color] : 'transparent'}`,
                opacity: isCurrent || !allRolled || isMax ? 1 : 0.5,
              }}
            >
              <span style={{ color: COLOR_HEX[color], fontWeight: 700 }}>● {player?.name}</span>
              <span style={{ fontSize: '1.5rem', fontWeight: 900, color: isMax ? COLOR_HEX[color] : 'var(--text-primary)' }}>
                {roll !== undefined ? roll : isCurrent ? '?' : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {winner && (
        <>
          <p style={{ textAlign: 'center', fontWeight: 700, fontSize: '1rem', marginTop: '4px' }}>
            <span style={{ color: COLOR_HEX[initialRollWinner] }}>{winner.name}</span> {t('initialRollStarts')}
          </p>
          {onStart
            ? <button className="btn btn-primary" style={{ width: '100%' }} onClick={onStart}>🎮 {t('setupStart')}</button>
            : <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>⏳ {t('waitingForHost')}</p>
          }
        </>
      )}

      {initialRollTied && !winner && (
        onContinue
          ? <button className="btn btn-secondary" style={{ width: '100%' }} onClick={onContinue}>🎲 {t('initialRollReroll')}</button>
          : <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>⏳ {t('waitingForHost')}</p>
      )}

      {!allRolled && (
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onRoll} disabled={!onRoll}>
          🎲 {currentPlayer?.name} {t('initialRollBtn')}
        </button>
      )}
    </Modal>
  );
}