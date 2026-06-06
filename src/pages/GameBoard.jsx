import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useGame } from '../hooks/useGame.js';
import { usePinchZoom } from '../hooks/usePinchZoom.js';
import { OUTER_PATH, INNER_PATH } from '../data/boardLayout.js';
import Board from '../components/Board/Board.jsx';
import PlayerPanel from '../components/PlayerPanel.jsx';
import Modal from '../components/Modal.jsx';
import { RulesContent } from './Rules.jsx';
import './GameBoard.css';
import './Rules.css';

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
  const { t, lang } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  const setup = loadSetup();
  useEffect(() => {
    if (!gameHook && !setup) navigate('/setup');
  }, []);

  const localHook = useGame(setup?.players || []);
  const { state, currentPlayer: rawCurrentPlayer, validMoves, placementMoves, rollDice, selectMove,
    skipPlaceSpecial, placeSpecial, resolveDuel, duelSetRoll, forceDuelTimeout, resolveMost, resolveKocka, kockaSetRoll, resolveZamjena,
    dismissSpecialInfo, endTurn, skipPlayerTurn, removePlayer, initialRoll, continueAfterTie, startGame,
  } = gameHook ?? localHook;

  // When everyone has been removed (e.g. two consecutive timeouts kicked
  // the last player), `state.players` is empty and `currentPlayer` is
  // undefined. Provide a safe placeholder so the topbar/board/PlayerPanel
  // can still render — the final-results modal renders on top.
  const currentPlayer = rawCurrentPlayer ?? {
    color: state.allColors?.[0] ?? 'red',
    name: '',
    figures: [],
    specialsHeld: [],
    skipCount: 0,
  };

  const { containerRef: boardAreaRef, transform: boardTransform } = usePinchZoom();

  const [selectedSpecialType, setSelectedSpecialType] = useState(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showRules, setShowRules]             = useState(false);
  const [showBombAlert, setShowBombAlert]     = useState(false);
  const [showStopAlert, setShowStopAlert]     = useState(false);
  const [showRewindAlert, setShowRewindAlert] = useState(false);
  const [showSkipWarning, setShowSkipWarning] = useState(false);
  const [inStuckRolls, setInStuckRolls] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const autoAdvanceRef = useRef(null);
  const prevArmedKeyRef = useRef(null);
  const prevStopArmedKeyRef = useRef(null);
  const prevRewindArmedKeyRef = useRef(null);
  const prevSkipTurnKeyRef = useRef(null);
  const prevStandingsLenRef = useRef(0);
  const [finishQueue, setFinishQueue] = useState([]);

  useEffect(() => {
    if (!isMyTurn || !state.players?.length) {
      prevArmedKeyRef.current = null;
      prevStopArmedKeyRef.current = null;
      prevRewindArmedKeyRef.current = null;
      return;
    }
    const me = state.players[state.currentPlayerIndex];
    if (!me) return;

    // BOMB armed
    const bombFig = me.figures.find(f => f.bombActive);
    const bombKey = bombFig ? `${state.currentPlayerIndex}-${bombFig.id}` : null;
    if (bombKey && bombKey !== prevArmedKeyRef.current) setShowBombAlert(true);
    prevArmedKeyRef.current = bombKey;

    // STOP armed (placer's own piece, must move this turn or becomes stopActive)
    const stopFig = me.figures.find(f => f.stopArmed);
    const stopKey = stopFig ? `${state.currentPlayerIndex}-${stopFig.id}` : null;
    if (stopKey && stopKey !== prevStopArmedKeyRef.current) setShowStopAlert(true);
    prevStopArmedKeyRef.current = stopKey;

    // REWIND armed (same pattern)
    const rewindFig = me.figures.find(f => f.rewindArmed);
    const rewindKey = rewindFig ? `${state.currentPlayerIndex}-${rewindFig.id}` : null;
    if (rewindKey && rewindKey !== prevRewindArmedKeyRef.current) setShowRewindAlert(true);
    prevRewindArmedKeyRef.current = rewindKey;
  }, [state.currentPlayerIndex, state.players, isMyTurn]);

  // Finish announcement queue: when state.standings grows, enqueue the new
  // entries so we can pop one modal per finisher in order. Fires on every
  // client (no isMyTurn gate) — all players see the celebration.
  useEffect(() => {
    const prev = prevStandingsLenRef.current;
    const curr = state.standings?.length ?? 0;
    if (curr > prev) {
      const newEntries = state.standings.slice(prev);
      setFinishQueue(q => [...q, ...newEntries]);
    }
    prevStandingsLenRef.current = curr;
  }, [state.standings]);

  // Skip warning: when the active player has skipCount > 0 (they missed their
  // last turn) and it's their turn again, pop a one-time "Final warning" modal.
  // Works for both offline (hot-seat: isMyTurn defaults to true → fires for
  // every current player) and online (only fires on the active player's screen).
  useEffect(() => {
    if (!isMyTurn || !state.players?.length) { prevSkipTurnKeyRef.current = null; return; }
    const me = state.players[state.currentPlayerIndex];
    if (!me || (me.skipCount ?? 0) === 0) { prevSkipTurnKeyRef.current = null; return; }
    const key = `${state.currentPlayerIndex}-${me.skipCount}`;
    if (key !== prevSkipTurnKeyRef.current) setShowSkipWarning(true);
    prevSkipTurnKeyRef.current = key;
  }, [state.currentPlayerIndex, state.players, isMyTurn]);

  // Derived
  const phase = state.phase;
  const isInitialRoll = phase === 'initial-roll';
  const isRolling = phase === 'rolling';
  const isMoving = phase === 'moving';
  const isSixAction = phase === 'six-action';
  const isDuel = phase === 'duel';
  const isSpecial = phase === 'special-trigger';
  const isOver = phase === 'game-over';
  const isNoMoves = phase === 'no-moves';

  // Track when player is in stuck 3-roll mode
  useEffect(() => {
    if (state.rollsLeft === 3) setInStuckRolls(true);
    if (!isRolling) setInStuckRolls(false);
  }, [state.rollsLeft, isRolling]);

  // Clear placement chip selection whenever six-action ends (placed, moved,
  // picked up, or turn advanced).
  useEffect(() => {
    if (!isSixAction && selectedSpecialType) setSelectedSpecialType(null);
  }, [isSixAction]);

  // Keep auto-advance ref current so interval closure always calls latest callbacks
  autoAdvanceRef.current = () => {
    if (!isMyTurn) return;
    if (phase === 'rolling') {
      // If this would be their 2nd consecutive missed roll (skipCount already 1),
      // kick directly instead of going skipCount=1→2 and waiting for the kick
      // effect. Belt-and-suspenders for the lone-survivor case where the kick
      // effect chain might lag.
      const me = state.players[state.currentPlayerIndex];
      if (me && (me.skipCount ?? 0) >= 1 && removePlayer) {
        removePlayer(me.color);
      } else {
        skipPlayerTurn?.(currentPlayer.color);
      }
    }
    else if (phase === 'moving') {
      if (validMoves.length > 0) {
        const m = validMoves[Math.floor(Math.random() * validMoves.length)];
        selectMove(m);
      } else {
        endTurn();
      }
    }
    else if (phase === 'six-action') {
      // Stage A timeout: random legal move if any; otherwise fall through to
      // Stage B (no skip-count increment per Rule 9 new).
      if (validMoves.length > 0) {
        const m = validMoves[Math.floor(Math.random() * validMoves.length)];
        selectMove(m);
      } else {
        skipPlaceSpecial();
      }
    }
    else if (phase === 'special-trigger') {
      const tr = state.specialTrigger;
      if (tr?.type === 'dice' && tr.d1 == null) {
        kockaSetRoll(Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1);
      } else if (tr?.type === 'swap') {
        if (zamjenaEligibleFigs.length > 0) {
          const pick = zamjenaEligibleFigs[Math.floor(Math.random() * zamjenaEligibleFigs.length)];
          resolveZamjena(tr, pick.playerColor, pick.figId);
        } else {
          resolveZamjena(tr, null, null);
        }
      } else if (tr?.type === 'bridge') {
        // Default to Stay on timeout (safe — no teleport).
        resolveMost(false, tr);
      } else if (tr?.type !== 'dice') {
        dismissSpecialInfo();
      }
    }
    // 'duel' phase is handled by a dedicated effect (runs on every client,
    // not gated by isMyTurn) — see duel-timeout effect below.
  };

  // Reset and start 30s countdown whenever a meaningful state change occurs
  // Include the active player's skipCount so the timer re-arms after every
  // SKIP_PLAYER_TURN — needed for the lone-survivor case where advanceTurn
  // loops right back to the same player and no other field would change.
  const stateKey = `${state.currentPlayerIndex}-${phase}-${state.diceValue}-${state.rollsLeft}-${state.duelState?.atkRoll ?? ''}-${state.duelState?.defRoll ?? ''}-${state.specialTrigger?.d1 ?? ''}-${state.players[state.currentPlayerIndex]?.skipCount ?? 0}`;
  useEffect(() => {
    if (isOver || isInitialRoll) return;
    setTimeLeft(30);
    let remaining = 30;
    const id = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        autoAdvanceRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [stateKey, isOver, isInitialRoll]);

  // Auto-advance after showing the dice result when there are no valid moves
  useEffect(() => {
    if (!isNoMoves) return;
    const timer = setTimeout(endTurn, 1500);
    return () => clearTimeout(timer);
  }, [isNoMoves, endTurn]);

  // Offline kick: when a player's skipCount reaches 2 in local (hot-seat) play,
  // remove them directly. Online play handles this via OnlineGameBoard's
  // room.players write — gated below so this never double-fires online.
  useEffect(() => {
    if (gameHook) return; // online uses room.players-write path
    const target = state.players.find(p => (p.skipCount ?? 0) >= 2);
    if (target?.color) removePlayer?.(target.color);
  }, [state.players, gameHook]);

  // Duel timeout: ~30 s after the last duel state change with at least one
  // roll missing, force-resolve per the rule. Runs on EVERY client (no
  // isMyTurn gate) so the duel can resolve even if both sides go idle.
  // Reducer's "both rolled → no-op" and "duelState missing → no-op" guards
  // make multi-client races idempotent.
  useEffect(() => {
    if (phase !== 'duel' || !state.duelState) return;
    if (!forceDuelTimeout) return;
    const id = setTimeout(() => forceDuelTimeout(), 30_000);
    return () => clearTimeout(id);
  }, [phase, state.duelState?.atkRoll, state.duelState?.defRoll]);

  // Auto-dismiss "own zamjena" info after 2.5s
  useEffect(() => {
    if (!isSpecial || state.specialTrigger?.type !== 'swap-own') return;
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

  const isZamjena = isSpecial && state.specialTrigger?.type === 'swap';
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

  const moveAndSixActionPhase = isMoving || isSixAction;

  // Which special types can be placed at all right now (any legal target piece).
  const placeableSpecials = new Set((placementMoves || []).map(pm => pm.specialType));

  // Placement targets for the currently selected special chip during six-action.
  // Each option is a (figId, ring, idx) — the cell of one of the placer's pieces
  // that's a legal target for `selectedSpecialType`.
  const activePlacementOptions = isSixAction && selectedSpecialType
    ? (placementMoves || []).filter(pm => pm.specialType === selectedSpecialType)
    : [];

  const placementTargets = activePlacementOptions.map(pm => ({ ring: pm.ring, idx: pm.idx }));

  // Moveable figures highlight. During six-action with a special chip selected,
  // show only the placement-target figures (so the player sees where they can
  // place). Otherwise show the regular move targets.
  const moveableFigures = (isMoving || isSixAction) && !selectedSpecialType
    ? validMoves.map(m => ({ figId: m.figId, playerColor: currentPlayer.color }))
    : isSixAction && selectedSpecialType
      ? activePlacementOptions.map(pm => ({ figId: pm.figId, playerColor: currentPlayer.color }))
      : isZamjena
        ? zamjenaEligibleFigs
        : [];

  const validTargets = moveAndSixActionPhase && !selectedSpecialType
    ? validMoves.filter(m => m.type !== 'pickup' && m.type !== 'pickup-bridge').map(m => {
        if (m.type === 'move' || m.type === 'exit') return { ring: m.ring, idx: m.idx };
        if (m.type === 'finish') return { lane: m.lane, color: m.color, slot: m.slot };
        return null;
      }).filter(Boolean)
    : isSixAction && selectedSpecialType
      ? placementTargets
      : [];

  function handleFigureClick(playerColor, figId) {
    if (!isMyTurn) return;
    if (isZamjena) {
      if (zamjenaEligibleFigs.some(f => f.figId === figId && f.playerColor === playerColor)) {
        resolveZamjena(state.specialTrigger, playerColor, figId);
      }
      return;
    }
    // Placement during six-action: clicking a placement-target piece places the
    // selected special on that piece's current cell. For BRIDGE on an inner
    // corner cell, two anchor options exist — show a direction picker.
    if (isSixAction && selectedSpecialType) {
      if (playerColor !== currentPlayer.color) return;
      const opts = activePlacementOptions.filter(pm => pm.figId === figId);
      if (opts.length === 0) return;
      if (opts.length === 1) {
        const o = opts[0];
        placeSpecial(o.ring, o.idx, selectedSpecialType, o.anchorRing, o.anchorIdx);
        setSelectedSpecialType(null);
      } else {
        setBridgeDirChoice({ figId, options: opts });
      }
      return;
    }
    if (!moveAndSixActionPhase) return;
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
  const [bridgeDirChoice, setBridgeDirChoice] = useState(null);

  const pickupMoves = moveAndSixActionPhase
    ? validMoves.filter(m => m.type === 'pickup' || m.type === 'pickup-bridge')
    : [];
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
    // Six-action with a special chip selected: clicking a placement-target cell
    // places the special on that piece. Inner corner cells with 2 anchor
    // options open the direction picker instead.
    if (isSixAction && selectedSpecialType) {
      let opts = [];
      if (cell.type === 'outer-path') {
        opts = activePlacementOptions.filter(pm => pm.ring === 'outer' && pm.idx === cell.outerIdx);
      } else if (cell.type === 'inner-path') {
        opts = activePlacementOptions.filter(pm => pm.ring === 'inner' && pm.idx === cell.innerIdx);
      }
      if (opts.length === 1) {
        const o = opts[0];
        placeSpecial(o.ring, o.idx, selectedSpecialType, o.anchorRing, o.anchorIdx);
        setSelectedSpecialType(null);
      } else if (opts.length > 1) {
        setBridgeDirChoice({ figId: opts[0].figId, options: opts });
      }
      return;
    }
    // Tap a target cell to select move (works for both moving and six-action).
    if (moveAndSixActionPhase) {
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
          {phase === 'rolling' && ' - 🎲'}
          {phase === 'moving' && ` - ${t('gamePhaseMoving')}`}
          {phase === 'six-action' && ` - ${t('gamePhaseMoving')}`}
          {phase === 'duel' && ` - ${t('gamePhaseDuel')}`}
        </span>
        <div className="game-topbar-actions">
          <button className="btn btn-ghost menu-theme-btn" onClick={() => setShowRules(true)} aria-label={t('menuRules')}>
            ❓
          </button>
          <button className="btn btn-ghost menu-theme-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? '🌙' : '🔅'}
          </button>
        </div>
      </div>

      {/* Turn timer bar */}
      {!isOver && !isInitialRoll && (
        <div className="game-timer-track">
          <div
            className={`game-timer-bar ${timeLeft <= 10 ? 'game-timer-bar--pulse' : ''}`}
            style={{
              width: `${(timeLeft / 30) * 100}%`,
              background: COLOR_HEX[currentPlayer.color],
            }}
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
        {state.players.length > 0 && (
          <PlayerPanel
            players={state.players}
            currentPlayerIndex={state.currentPlayerIndex}
            phase={phase}
            isMyTurn={isMyTurn}
            placeableSpecials={placeableSpecials}
            onSelectSpecialForPlace={type => {
              if (!isMyTurn || !isSixAction) return;
              if (!placeableSpecials.has(type)) return;
              setSelectedSpecialType(type === selectedSpecialType ? null : type);
            }}
            selectedSpecial={selectedSpecialType}
            hasPickup={hasPickup}
            onPickup={handlePickupBtn}
            t={t}
          />
        )}
        <div className="game-controls">
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

      {/* Bridge direction picker (inner corner cells with two anchor options) */}
      {bridgeDirChoice && (() => {
        const DIR_ICONS = { top: '⬆️', left: '⬅️', right: '➡️', bottom: '⬇️' };
        const DIR_LABELS = {
          top: t('bridgeDirTop')    || 'Top',
          left: t('bridgeDirLeft')  || 'Left',
          right: t('bridgeDirRight')|| 'Right',
          bottom: t('bridgeDirBottom') || 'Bottom',
        };
        return (
          <Modal title={`🌉 ${t('specialBridge')}`} onClose={() => setBridgeDirChoice(null)}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
              {t('bridgeDirectionQ') || 'Choose bridge direction'}
            </p>
            {bridgeDirChoice.options.map(o => (
              <button
                key={`${o.anchorRing}-${o.anchorIdx}`}
                className="btn btn-secondary"
                onClick={() => {
                  placeSpecial(o.ring, o.idx, 'bridge', o.anchorRing, o.anchorIdx);
                  setBridgeDirChoice(null);
                  setSelectedSpecialType(null);
                }}
              >
                {DIR_ICONS[o.dir] || '🌉'} {DIR_LABELS[o.dir] || o.dir}
              </button>
            ))}
          </Modal>
        );
      })()}

      {/* Pickup choice modal */}
      {pickupChoiceMoves && (() => {
        const SPECIAL_ICONS = { bridge: '🌉', dice: '🎲', rewind: '⏪', bomb: '💣', stop: '⏸️', swap: '🔄' };
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
                  {multiFig ? `${t('swapFig')} ${m.figId + 1} - ${fieldLabel}` : fieldLabel}
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
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
              <span style={{ color: COLOR_HEX[ds.atkColor], fontWeight: 600 }}>● {atkName}</span>
              {' '}{t('duelVs')}{' '}
              <span style={{ color: COLOR_HEX[ds.defColor], fontWeight: 600 }}>● {defName}</span>
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
      {isSpecial && state.specialTrigger && state.specialTrigger.type !== 'swap' && (
        <SpecialModal
          trigger={state.specialTrigger}
          players={state.players}
          t={t}
          isMyTurn={isMyTurn}
          onMost={(cross, crossOptionIdx) => resolveMost(cross, state.specialTrigger, crossOptionIdx)}
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

      {showRules && (
        <Modal title={t('rulesTitle')} onClose={() => setShowRules(false)} wide>
          <RulesContent lang={lang} />
        </Modal>
      )}

      {showBombAlert && (
        <Modal title={t('bombAlertTitle')} onClose={() => setShowBombAlert(false)}>
          <p style={{ textAlign: 'center', fontSize: '2rem' }}>💣</p>
          <p style={{ textAlign: 'center' }}>{t('bombAlertMsg')}</p>
          <button className="btn btn-primary" onClick={() => setShowBombAlert(false)}>{t('ok')}</button>
        </Modal>
      )}

      {showStopAlert && (
        <Modal title={t('stopAlertTitle')} onClose={() => setShowStopAlert(false)}>
          <p style={{ textAlign: 'center', fontSize: '2rem' }}>⏸️</p>
          <p style={{ textAlign: 'center' }}>{t('stopAlertMsg')}</p>
          <button className="btn btn-primary" onClick={() => setShowStopAlert(false)}>{t('ok')}</button>
        </Modal>
      )}

      {showRewindAlert && (
        <Modal title={t('rewindAlertTitle')} onClose={() => setShowRewindAlert(false)}>
          <p style={{ textAlign: 'center', fontSize: '2rem' }}>⏪</p>
          <p style={{ textAlign: 'center' }}>{t('rewindAlertMsg')}</p>
          <button className="btn btn-primary" onClick={() => setShowRewindAlert(false)}>{t('ok')}</button>
        </Modal>
      )}

      {showSkipWarning && (
        <Modal title={t('skipWarningTitle')} onClose={() => setShowSkipWarning(false)}>
          <p style={{ textAlign: 'center', fontSize: '2rem' }}>⏳</p>
          <p style={{ textAlign: 'center' }}>{t('skipWarningMsg')}</p>
          <button className="btn btn-primary" onClick={() => setShowSkipWarning(false)}>{t('ok')}</button>
        </Modal>
      )}

      {/* Finish announcement — one modal per finisher, queued in order. */}
      {finishQueue.length > 0 && !isOver && (() => {
        const color = finishQueue[0];
        const placeIdx = (state.standings || []).indexOf(color);
        const place = placeIdx + 1;
        const medal = ['🥇','🥈','🥉'][placeIdx] ?? '🎖️';
        const name = state.players.find(p => p.color === color)?.name
                    ?? state.initialNames?.[color]
                    ?? color;
        return (
          <Modal title={t('gameFinishedPlaceTitle')} onClose={() => setFinishQueue(q => q.slice(1))}>
            <p style={{ textAlign: 'center', fontSize: '2.5rem', margin: 0 }}>{medal}</p>
            <p style={{ textAlign: 'center' }}>
              <strong style={{ color: COLOR_HEX[color] }}>{name}</strong>{' '}
              {t('gameFinishedPlaceMsg')} {place}.
            </p>
            <button className="btn btn-primary" onClick={() => setFinishQueue(q => q.slice(1))}>{t('ok')}</button>
          </Modal>
        );
      })()}

      {/* Final results — full standings + DNFs */}
      {isOver && (() => {
        const standings = state.standings || [];
        const allColors = state.allColors || state.players.map(p => p.color);
        const names = state.initialNames || {};
        const playerNameOf = (c) =>
          state.players.find(p => p.color === c)?.name ?? names[c] ?? c;
        const dnfColors = allColors.filter(c =>
          !standings.includes(c) && !state.players.some(p => p.color === c)
        );
        return (
        <Modal title={t('gameFinalResultsTitle')}>
          <p style={{ textAlign: 'center', fontSize: '2rem', margin: 0 }}>🏆</p>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px', margin: '8px 0' }}>
            {standings.map((color, i) => {
              const medal = ['🥇','🥈','🥉'][i] ?? '🎖️';
              return (
                <div key={color} style={{ textAlign: 'center' }}>
                  <strong style={{ color: COLOR_HEX[color] }}>{medal} {i + 1}. {playerNameOf(color)}</strong>
                </div>
              );
            })}
            {dnfColors.map(color => (
              <div key={color} style={{ textAlign: 'center', opacity: 0.5 }}>
                <strong style={{ color: COLOR_HEX[color] }}>— {t('gameDNF')} — {playerNameOf(color)}</strong>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => navigate(playAgainPath)}>
            {t('gamePlayAgain')}
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            {t('gameMainMenu')}
          </button>
        </Modal>
        );
      })()}
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
    <div className="swap-strip">
      <div className="swap-strip-info">
        <span className="swap-strip-icon">🔄</span>
        <span className="swap-strip-label">{t('specialSwap')}</span>
        {currentPlayer && !isMyTurn && (
          <span className="swap-strip-waiting">({currentPlayer.name})</span>
        )}
      </div>
      <div className="swap-strip-figs">
        {eligibleFigs.length === 0 && (
          <span className="swap-strip-empty">{t('swapNoFigs')}</span>
        )}
        {eligibleFigs.map(f => (
          <button
            key={f.figId}
            className="swap-fig-btn"
            style={{ background: ZAMJENA_COLOR_HEX[f.playerColor] }}
            onClick={() => isMyTurn && onSelect(f.playerColor, f.figId)}
            disabled={!isMyTurn}
          >
            <span className="swap-fig-num">{f.figId + 1}</span>
            <span className="swap-fig-coord">{f.row},{f.col}</span>
          </button>
        ))}
      </div>
      {eligibleFigs.length === 0 && (
        <button
          className="btn btn-ghost swap-skip-btn"
          onClick={() => isMyTurn && onSkip()}
          disabled={!isMyTurn}
        >✕</button>
      )}
    </div>
  );
}

function KockaModal({ t, trigger, players, onKockaSetRoll, onKocka, isMyTurn = true }) {
  const rolled = trigger.d1 != null;
  const activeName = players?.find(p => p.color === trigger.playerColor)?.name || trigger.playerColor;

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

  const ownerLine = (
    <p style={{
      textAlign: 'center',
      fontWeight: 700,
      fontSize: '0.95rem',
      color: COLOR_HEX[trigger.playerColor],
      margin: 0,
    }}>
      ● {activeName}
    </p>
  );

  return (
    <Modal title={`🎲 ${t('specialDice')}`}>
      {ownerLine}
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('specialDiceMsg')}</p>
      {rolled ? (
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center', fontSize: '1.4rem', fontWeight: 900, margin: '8px 0' }}>
          <span>🎲 {trigger.d1}</span>
          <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>+</span>
          <span>🎲 {trigger.d2}</span>
          <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>=</span>
          <span style={{ color: 'var(--accent)' }}>{trigger.d1 + trigger.d2}</span>
        </div>
      ) : isMyTurn ? (
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleRoll}>
          🎲 🎲 {t('gameRoll')}
        </button>
      ) : (
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          ⏳ {activeName} {t('waitingForPlayer')}
        </p>
      )}
    </Modal>
  );
}

function SpecialModal({ trigger, players, t, isMyTurn = true, onMost, onKockaSetRoll, onKocka, onDismiss }) {
  const activeName = players?.find(p => p.color === trigger.playerColor)?.name || trigger.playerColor;
  const ownerLine = (
    <p style={{
      textAlign: 'center',
      fontWeight: 700,
      fontSize: '0.95rem',
      color: COLOR_HEX[trigger.playerColor],
      margin: 0,
    }}>
      ● {activeName}
    </p>
  );

  if (trigger.type === 'stop') {
    return (
      <Modal title={`⏸️ ${t('specialStop')}`}>
        {ownerLine}
        <p style={{ textAlign: 'center', fontSize: '0.95rem' }}>{t('specialStopMsg')}</p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDismiss} disabled={!isMyTurn}>{t('ok')}</button>
      </Modal>
    );
  }

  if (trigger.type === 'rewind') {
    return (
      <Modal title={`⏪ ${t('specialRewind')}`}>
        {ownerLine}
        <p style={{ textAlign: 'center', fontSize: '0.95rem' }}>{t('specialRewindMsg')}</p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDismiss} disabled={!isMyTurn}>{t('ok')}</button>
      </Modal>
    );
  }

  if (trigger.type === 'bomb') {
    return (
      <Modal title={`💣 ${t('specialBomb')}`}>
        {ownerLine}
        <p style={{ textAlign: 'center', fontSize: '0.95rem' }}>{t('specialBombMsg')}</p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onDismiss} disabled={!isMyTurn}>{t('ok')}</button>
      </Modal>
    );
  }

  if (trigger.type === 'bridge') {
    const crossOptions = trigger.crossOptions || [];
    const myPath = trigger.ring === 'outer' ? OUTER_PATH : INNER_PATH;
    const myCell = myPath[trigger.idx];
    function dirOf(opt) {
      const oPath = opt.otherRing === 'outer' ? OUTER_PATH : INNER_PATH;
      const oc = oPath[opt.otherIdx];
      if (oc.r < myCell.r) return 'top';
      if (oc.r > myCell.r) return 'bottom';
      if (oc.c < myCell.c) return 'left';
      return 'right';
    }
    const DIR_ICONS = { top: '⬆️', left: '⬅️', right: '➡️', bottom: '⬇️' };
    const DIR_LABELS = {
      top: t('bridgeDirTop') || 'Top',
      left: t('bridgeDirLeft') || 'Left',
      right: t('bridgeDirRight') || 'Right',
      bottom: t('bridgeDirBottom') || 'Bottom',
    };
    return (
      <Modal title={`🌉 ${t('specialBridge')}`}>
        {ownerLine}
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('specialBridgeQ')}</p>
        {isMyTurn ? (
          <>
            <button className="btn btn-secondary" onClick={() => onMost(false)}>{t('specialBridgeStay')}</button>
            {crossOptions.length <= 1 ? (
              <button className="btn btn-primary" onClick={() => onMost(true, 0)}>{t('specialBridgeCross')}</button>
            ) : (
              crossOptions.map((opt, i) => {
                const d = dirOf(opt);
                return (
                  <button key={i} className="btn btn-primary" onClick={() => onMost(true, i)}>
                    {DIR_ICONS[d]} {t('specialBridgeCross')} ({DIR_LABELS[d]})
                  </button>
                );
              })
            )}
          </>
        ) : (
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
            ⏳ {activeName} {t('waitingForPlayer')}
          </p>
        )}
      </Modal>
    );
  }

  if (trigger.type === 'dice') {
    return <KockaModal key={`${trigger.ring}-${trigger.idx}`} t={t} trigger={trigger} players={players} onKockaSetRoll={onKockaSetRoll} onKocka={onKocka} isMyTurn={isMyTurn} />;
  }

  if (trigger.type === 'swap-own') {
    return (
      <Modal title={`🔄 ${t('specialSwap')}`}>
        {ownerLine}
        <p style={{ textAlign: 'center', fontSize: '0.95rem' }}>{t('swapOwnField')}</p>
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
                {roll !== undefined ? roll : isCurrent ? '?' : '-'}
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