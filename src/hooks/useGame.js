import { useReducer, useCallback } from 'react';
import {
  OUTER_PATH, INNER_PATH, PLAYERS,
  advanceCW, advanceCCW,
  distributeSpecials, canPlaceSpecial, canPlaceMost, getBridgeParallel,
} from '../data/boardLayout.js';

const OUTER_LEN = OUTER_PATH.length; // 72
const INNER_LEN = INNER_PATH.length; // 48

// Inner corner cells where a BRIDGE has TWO possible outer anchors (one per
// perpendicular direction). When placing a bridge from one of these inner
// cells, the user picks which anchor → which direction the bridge runs.
// Each anchor here is `{anchorRing, anchorIdx, dir}`; dir is the cardinal
// direction the bridge extends FROM the inner corner cell.
const INNER_CORNER_ANCHORS = {
  0:  [{ anchorRing: 'outer', anchorIdx: 3,  dir: 'top'    }, { anchorRing: 'outer', anchorIdx: 69, dir: 'left'   }],
  12: [{ anchorRing: 'outer', anchorIdx: 15, dir: 'top'    }, { anchorRing: 'outer', anchorIdx: 21, dir: 'right'  }],
  24: [{ anchorRing: 'outer', anchorIdx: 33, dir: 'right'  }, { anchorRing: 'outer', anchorIdx: 39, dir: 'bottom' }],
  36: [{ anchorRing: 'outer', anchorIdx: 51, dir: 'bottom' }, { anchorRing: 'outer', anchorIdx: 57, dir: 'left'   }],
};

// Find every bridge connecting to (ring, idx). A bridge connects two cells:
// its anchor (the bridgesOnBoard key) and getBridgeParallel(anchor). We may
// be either endpoint. Returns [{anchor, other, placedBy}, ...].
export function getBridgesAt(ring, idx, bridgesOnBoard) {
  const result = [];
  for (const [key, bridge] of Object.entries(bridgesOnBoard || {})) {
    const [r, iStr] = key.split('-');
    const i = Number(iStr);
    if (r === ring && i === idx) {
      const other = getBridgeParallel(r, i);
      if (other) result.push({ anchor: { ring: r, idx: i }, other, placedBy: bridge.placedBy });
      continue;
    }
    const parallel = getBridgeParallel(r, i);
    if (parallel && parallel.ring === ring && parallel.idx === idx) {
      result.push({ anchor: { ring: r, idx: i }, other: { ring: r, idx: i }, placedBy: bridge.placedBy });
    }
  }
  return result;
}

function rollD6() {
  return Math.floor(Math.random() * 6) + 1;
}

function initFigures() {
  return [
    { id: 0, pos: 'home', rewindNext: false, stopActive: false, bombActive: null, stopArmed: false, rewindArmed: false },
    { id: 1, pos: 'home', rewindNext: false, stopActive: false, bombActive: null, stopArmed: false, rewindArmed: false },
    { id: 2, pos: 'home', rewindNext: false, stopActive: false, bombActive: null, stopArmed: false, rewindArmed: false },
    { id: 3, pos: 'home', rewindNext: false, stopActive: false, bombActive: null, stopArmed: false, rewindArmed: false },
  ];
}

function initState(setupPlayers) {
  return {
    players: setupPlayers.map(sp => ({
      color: sp.color,
      name: sp.name,
      uid: sp.uid ?? null,
      figures: initFigures(),
      specialsHeld: distributeSpecials(setupPlayers.length),
      skipCount: 0,
    })),
    currentPlayerIndex: 0,
    diceValue: null,
    secondDiceValue: null,
    rollsLeft: 1,
    bonusRoll: false,
    phase: 'initial-roll',
    specialsOnBoard: {},
    bridgesOnBoard: {},
    duelState: null,
    specialTrigger: null,
    // Server-committed seed for a verifiable dice roll (online play). null when
    // no roll is in flight; see useOnlineGame's two-phase roll + firestore.rules.
    rollSeed: null,
    // Finish standings — colors in finish order. First entry = 1st place.
    // Replaces the old single `winner` field. Game-over fires when every
    // remaining (non-DNF) player has been appended.
    standings: [],
    // Snapshots taken at START_GAME so DNF names can still be rendered after a
    // kicked player is removed from `players`.
    allColors: [],
    initialNames: {},
    // Initial roll state (rule 2)
    initialRollOrder: setupPlayers.map(sp => sp.color),
    initialRolls: {},     // colorKey → value rolled this round
    initialRollIdx: 0,    // index into initialRollOrder of who rolls next
    initialRollWinner: null,  // set when one player wins
    initialRollTied: false,   // set when round ends in a tie
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pathLen(ring) {
  return ring === 'outer' ? OUTER_LEN : INNER_LEN;
}


function playerDef(color) {
  return PLAYERS[color];
}

function figureOnPath(pos, ring, idx) {
  return typeof pos === 'object' && pos.ring === ring && pos.idx === idx;
}

function figureInFinish(pos, colorKey, lane, slot) {
  return typeof pos === 'object' && pos.lane === lane && pos.color === colorKey && pos.slot === slot;
}

function isAllStuck(player) {
  const figs = player.figures;
  const atHome = figs.filter(f => f.pos === 'home').length;
  if (atHome === 4) return true;
  const finishFigs = figs.filter(f => typeof f.pos === 'object' && f.pos.lane === 'finish');
  const pathFigs = figs.filter(f => typeof f.pos === 'object' && f.pos.ring);
  if (pathFigs.length > 0) return false;
  const slots = finishFigs.map(f => f.pos.slot).sort((a, b) => b - a);
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== 4 - i) return false;
  }
  return true;
}

function isWinner(player) {
  return player.figures.every(f =>
    typeof f.pos === 'object' && f.pos.lane === 'finish'
  );
}

function findFigureOnCell(players, ring, idx) {
  for (const p of players) {
    for (const f of p.figures) {
      if (figureOnPath(f.pos, ring, idx)) {
        return { player: p, figure: f };
      }
    }
  }
  return null;
}

function findFigureInFinish(players, colorKey, lane, slot) {
  for (const p of players) {
    for (const f of p.figures) {
      if (figureInFinish(f.pos, colorKey, lane, slot)) {
        return { player: p, figure: f };
      }
    }
  }
  return null;
}

// ── Placement target calculation ───────────────────────────────────────────

// True iff the figure's current cell is a legal target to place `specialType`.
// Used by PLACE_SPECIAL and by the six-action UI to highlight placement spots.
//
// Rules:
// - figure must be on a path/inner cell (not home, not finish)
// - cell must not be a HOME-exit (canPlaceSpecial)
// - for non-bridge specialType: cell must not host another non-bridge special
// - for 'bridge': canPlaceMost (both endpoints free of bridges)
// BRIDGE-coexistence: a non-bridge special on a cell with a bridge is allowed,
// and a bridge on a cell with a non-bridge special is allowed.
function getPlacementTarget(state, color, figId, specialType) {
  const player = state.players.find(p => p.color === color);
  if (!player) return null;
  const fig = player.figures.find(f => f.id === figId);
  if (!fig || typeof fig.pos !== 'object' || !fig.pos.ring) return null;
  const { ring, idx } = fig.pos;
  const activeColors = state.players.map(p => p.color);
  // BRIDGE can be placed on EXIT cells (Rule 9.2 new). Other specials cannot.
  const allowExit = specialType === 'bridge';
  if (!canPlaceSpecial(ring, idx, activeColors, allowExit)) return null;
  const spKey = `${ring}-${idx}`;
  if (specialType === 'bridge') {
    if (!canPlaceMost(ring, idx, state.bridgesOnBoard)) return null;
    return { ring, idx };
  }
  if (state.specialsOnBoard[spKey]) return null;
  return { ring, idx };
}

// All placement options for the current player on a 6-roll: cross-product of
// (held special types) × (their own pieces on path cells legal for that type).
// Each entry carries `anchorRing/anchorIdx` — where the storage key goes.
// For non-bridge specials or non-corner BRIDGE placements, the anchor IS the
// piece's cell. For BRIDGE on an inner corner cell, two entries are emitted
// (one per perpendicular outer anchor) so the UI can ask which direction.
export function getPlacementMoves(state) {
  const player = state.players[state.currentPlayerIndex];
  if (!player) return [];
  const uniqueSpecials = [...new Set(player.specialsHeld)];
  const results = [];
  uniqueSpecials.forEach(specialType => {
    player.figures.forEach(fig => {
      if (typeof fig.pos !== 'object' || !fig.pos.ring) return;
      const { ring, idx } = fig.pos;

      // Bridge on inner corner: emit one entry per valid outer anchor.
      if (specialType === 'bridge' && ring === 'inner' && INNER_CORNER_ANCHORS[idx]) {
        INNER_CORNER_ANCHORS[idx].forEach(({ anchorRing, anchorIdx, dir }) => {
          if (!canPlaceMost(anchorRing, anchorIdx, state.bridgesOnBoard)) return;
          results.push({
            specialType: 'bridge',
            figId: fig.id,
            ring, idx,
            anchorRing, anchorIdx,
            dir,
          });
        });
        return;
      }

      const t = getPlacementTarget(state, player.color, fig.id, specialType);
      if (!t) return;
      results.push({
        specialType, figId: fig.id,
        ring: t.ring, idx: t.idx,
        anchorRing: t.ring, anchorIdx: t.idx,
      });
    });
  });
  return results;
}

// ── Valid move calculation ─────────────────────────────────────────────────

export function getValidMoves(state, diceVal) {
  const player = state.players[state.currentPlayerIndex];
  const moves = [];

  player.figures.forEach(fig => {
    // Pickup: dice = 6, figure standing on a special or bridge square (stop restriction doesn't block this)
    if (diceVal === 6 && typeof fig.pos === 'object' && fig.pos.ring) {
      const spKey = `${fig.pos.ring}-${fig.pos.idx}`;
      if (state.specialsOnBoard[spKey]) {
        moves.push({ figId: fig.id, type: 'pickup', ring: fig.pos.ring, idx: fig.pos.idx });
      }
      // pickup-bridge: any bridge whose endpoints include this cell (anchor or
      // the parallel-of-anchor). One pickup-bridge move per connecting bridge.
      const connecting = getBridgesAt(fig.pos.ring, fig.pos.idx, state.bridgesOnBoard);
      connecting.forEach(b => {
        moves.push({
          figId: fig.id, type: 'pickup-bridge',
          ring: fig.pos.ring, idx: fig.pos.idx,
          anchorRing: b.anchor.ring, anchorIdx: b.anchor.idx,
        });
      });
    }

    // STOP: can only move if dice = 1
    if (fig.stopActive && diceVal !== 1) return;

    if (fig.pos === 'home') {
      if (diceVal === 6) {
        // Can exit to outer or inner ring; opponent on exit cell triggers a duel,
        // only own piece blocks the exit.
        const pd = playerDef(player.color);
        const outerOcc = findFigureOnCell(state.players, 'outer', pd.exitOuter);
        if (!outerOcc || outerOcc.player.color !== player.color) {
          moves.push({ figId: fig.id, type: 'exit', ring: 'outer', idx: pd.exitOuter });
        }
        const innerOcc = findFigureOnCell(state.players, 'inner', pd.exitInner);
        if (!innerOcc || innerOcc.player.color !== player.color) {
          moves.push({ figId: fig.id, type: 'exit', ring: 'inner', idx: pd.exitInner });
        }
      }
      return;
    }

    if (typeof fig.pos === 'object' && fig.pos.ring) {
      const { ring, idx } = fig.pos;
      const len = pathLen(ring);
      const pd = playerDef(player.color);

      if (fig.rewindNext) {
        // Rule 9.c: a rewinding piece may NOT pass its own exit cell on the
        // current ring. If the dice value would land beyond the exit, the
        // move is illegal — don't surface it as a valid option.
        const exitIdx = ring === 'inner' ? pd.exitInner : pd.exitOuter;
        const stepsBackToExit = (idx - exitIdx + len) % len;
        if (diceVal > stepsBackToExit) return; // illegal — past own exit
        const targetIdx = advanceCCW(idx, diceVal, len);
        if (!findFigureOnCell(state.players, ring, targetIdx)) {
          moves.push({ figId: fig.id, type: 'move', ring, idx: targetIdx, rewind: true });
        }
        return;
      }

      if (ring === 'inner') {
        const stepsToFinish = (pd.finishEntryIdx - idx + len) % len;
        if (diceVal <= stepsToFinish) {
          const targetIdx = advanceCW(idx, diceVal, len);
          const occupant = findFigureOnCell(state.players, ring, targetIdx);
          if (!occupant || occupant.player.color !== player.color) {
            moves.push({ figId: fig.id, type: 'move', ring, idx: targetIdx });
          }
        } else {
          const slot = diceVal - stepsToFinish;
          if (slot >= 1 && slot <= 4) {
            if (!findFigureInFinish(state.players, player.color, 'finish', slot)) {
              moves.push({ figId: fig.id, type: 'finish', lane: 'finish', color: player.color, slot });
            }
          }
          // else overshoot (slot > 4) — no valid move
        }
      } else {
        // Outer ring (rule 5): piece must stop BEFORE its own exit cell.
        // It can never land on or pass through its own exit on the way clockwise.
        // stepsToExit = how many cells clockwise until landing on exitOuter.
        // If currently AT the exit (just spawned), allow a full lap minus one.
        let stepsToExit = (pd.exitOuter - idx + len) % len;
        if (stepsToExit === 0) stepsToExit = len;
        if (diceVal >= stepsToExit) return; // would land on or pass the exit — illegal
        const targetIdx = advanceCW(idx, diceVal, len);
        const occupant = findFigureOnCell(state.players, ring, targetIdx);
        if (!occupant || occupant.player.color !== player.color) {
          moves.push({ figId: fig.id, type: 'move', ring, idx: targetIdx });
        }
      }
      return;
    }

    if (typeof fig.pos === 'object' && fig.pos.lane) {
      // In finish lane — advance deeper
      const { lane, color, slot } = fig.pos;
      const nextSlot = slot + diceVal;
      if (nextSlot <= 4) {
        if (!findFigureInFinish(state.players, color, lane, nextSlot)) {
          moves.push({ figId: fig.id, type: 'finish', lane, color, slot: nextSlot });
        }
      }
    }
  });

  return moves;
}

// ── Reducer ────────────────────────────────────────────────────────────────


function advanceTurn(state) {
  const n = state.players.length;
  if (n === 0) return { ...state, phase: 'game-over' };
  const standings = state.standings || [];
  let nextIdx = (state.currentPlayerIndex + 1) % n;
  // Skip past any player whose color is already in the finish standings.
  for (let i = 0; i < n; i++) {
    if (!standings.includes(state.players[nextIdx].color)) break;
    nextIdx = (nextIdx + 1) % n;
  }
  if (standings.includes(state.players[nextIdx].color)) {
    // Everyone in standings — defensive (applyMove should have already ended).
    return { ...state, phase: 'game-over' };
  }
  const nextPlayer = state.players[nextIdx];
  const stuck = isAllStuck(nextPlayer);
  return {
    ...state,
    currentPlayerIndex: nextIdx,
    diceValue: null,
    secondDiceValue: null,
    rollsLeft: stuck ? 3 : 1,
    bonusRoll: false,
    phase: 'rolling',
    rollSeed: null, // clear any verifiable-roll seed on turn handoff
  };
}

function deepCopyPlayers(players) {
  return players.map(p => ({
    ...p,
    figures: p.figures.map(f => ({ ...f })),
    specialsHeld: [...p.specialsHeld],
  }));
}

function applyMove(state, move) {
  const player = state.players[state.currentPlayerIndex];

  if (move.type === 'pickup') {
    const spKey = `${move.ring}-${move.idx}`;
    const special = state.specialsOnBoard[spKey];
    if (!special) return state;
    let newPlayers = deepCopyPlayers(state.players);
    const mover = newPlayers.find(p => p.color === player.color);
    const fig = mover.figures.find(f => f.id === move.figId);
    fig.stopActive = false;
    fig.rewindNext = false;
    fig.bombActive = null; // using this piece this turn saves it from detonation
    fig.stopArmed = false;
    fig.rewindArmed = false;
    mover.specialsHeld = [...mover.specialsHeld, special.type];
    const newSpecials = { ...state.specialsOnBoard };
    delete newSpecials[spKey];
    mover.figures.filter(f => f.id !== move.figId && f.bombActive).forEach(armed => {
      if (typeof armed.pos === 'object' && armed.pos.ring) {
        delete newSpecials[`${armed.pos.ring}-${armed.pos.idx}`];
      }
      mover.specialsHeld = [...mover.specialsHeld, 'bomb'];
      armed.pos = 'home';
      armed.stopActive = false;
      armed.rewindNext = false;
      armed.bombActive = null;
      armed.stopArmed = false;
      armed.rewindArmed = false;
    });
    // Armed STOP/REWIND on OTHER pieces: promote to active.
    mover.figures.filter(f => f.id !== move.figId).forEach(armed => {
      if (armed.stopArmed)   { armed.stopActive = true;   armed.stopArmed = false; }
      if (armed.rewindArmed) { armed.rewindNext = true;   armed.rewindArmed = false; }
    });
    return { ...state, players: newPlayers, specialsOnBoard: newSpecials, phase: 'rolling', diceValue: null, bonusRoll: false, rollsLeft: 1 };
  }

  if (move.type === 'pickup-bridge') {
    // anchorRing/Idx is the bridgesOnBoard key (may differ from the piece's
    // cell when the bridge is anchored on the parallel side, e.g. inner
    // corner cells served by a bridge anchored at an outer cell).
    const aRing = move.anchorRing || move.ring;
    const aIdx = move.anchorIdx != null ? move.anchorIdx : move.idx;
    const anchorKey = `${aRing}-${aIdx}`;
    if (!state.bridgesOnBoard[anchorKey]) return state;
    let newPlayers = deepCopyPlayers(state.players);
    let newSpecials = { ...state.specialsOnBoard };
    const mover = newPlayers.find(p => p.color === player.color);
    const fig = mover.figures.find(f => f.id === move.figId);
    // Do NOT clear stopActive/rewindNext/bombActive — the special field that caused
    // those effects is still on the board, so the piece stays under its effect.
    mover.specialsHeld = [...mover.specialsHeld, 'bridge'];
    const newBridges = { ...state.bridgesOnBoard };
    delete newBridges[anchorKey];
    mover.figures.filter(f => f.id !== move.figId && f.bombActive).forEach(armed => {
      if (typeof armed.pos === 'object' && armed.pos.ring) {
        delete newSpecials[`${armed.pos.ring}-${armed.pos.idx}`];
      }
      mover.specialsHeld = [...mover.specialsHeld, 'bomb'];
      armed.pos = 'home';
      armed.stopActive = false;
      armed.rewindNext = false;
      armed.bombActive = null;
      armed.stopArmed = false;
      armed.rewindArmed = false;
    });
    // Armed STOP/REWIND on OTHER pieces: promote to active.
    mover.figures.filter(f => f.id !== move.figId).forEach(armed => {
      if (armed.stopArmed)   { armed.stopActive = true;   armed.stopArmed = false; }
      if (armed.rewindArmed) { armed.rewindNext = true;   armed.rewindArmed = false; }
    });
    return { ...state, players: newPlayers, specialsOnBoard: newSpecials, bridgesOnBoard: newBridges, phase: 'rolling', diceValue: null, bonusRoll: false, rollsLeft: 1 };
  }

  let newPlayers = deepCopyPlayers(state.players);
  let newSpecials = { ...state.specialsOnBoard };
  const mover = newPlayers.find(p => p.color === player.color);
  const fig = mover.figures.find(f => f.id === move.figId);

  // Clear flags on move
  fig.rewindNext = false;
  fig.stopActive = false;
  fig.bombActive = null; // escaped the bomb by moving (bomb remains on the square)
  fig.stopArmed = false;   // moved → armed STOP doesn't escalate to stopActive
  fig.rewindArmed = false; // moved → armed REWIND doesn't escalate to rewindNext

  if (move.type === 'exit') {
    fig.pos = { ring: move.ring, idx: move.idx };
  } else if (move.type === 'move') {
    fig.pos = { ring: move.ring, idx: move.idx };
    if (move.rewind) fig.rewindNext = false; // already moved backward, flag consumed
  } else if (move.type === 'finish') {
    fig.pos = { lane: move.lane, color: move.color, slot: move.slot };
  }

  // Detonate any other armed figures of the current player that weren't moved
  mover.figures.filter(f => f.id !== move.figId && f.bombActive).forEach(armed => {
    if (typeof armed.pos === 'object' && armed.pos.ring) {
      delete newSpecials[`${armed.pos.ring}-${armed.pos.idx}`];
    }
    mover.specialsHeld = [...mover.specialsHeld, 'bomb'];
    armed.pos = 'home';
    armed.stopActive = false;
    armed.rewindNext = false;
    armed.bombActive = null;
    armed.stopArmed = false;
    armed.rewindArmed = false;
  });

  // Armed STOP/REWIND on OTHER pieces (not the one moved): promote to active.
  mover.figures.filter(f => f.id !== move.figId).forEach(armed => {
    if (armed.stopArmed)   { armed.stopActive = true;   armed.stopArmed = false; }
    if (armed.rewindArmed) { armed.rewindNext = true;   armed.rewindArmed = false; }
  });

  // Check finish — first finisher gets 1st place, but the game continues so
  // others can race for 2nd / 3rd / etc. Game-over only when every remaining
  // (non-DNF) player has been placed.
  const finisher = newPlayers.find(p =>
    isWinner(p) && !(state.standings || []).includes(p.color)
  );
  let newStandings = state.standings || [];
  if (finisher) {
    newStandings = [...newStandings, finisher.color];
    const allDone = newPlayers.every(p => newStandings.includes(p.color));
    if (allDone) {
      return {
        ...state,
        players: newPlayers,
        specialsOnBoard: newSpecials,
        standings: newStandings,
        phase: 'game-over',
      };
    }
  }
  // Propagate the updated standings through whichever post-move path runs.
  state = { ...state, standings: newStandings };

  // Finish lane: no specials / bridges / duels apply — straight to afterMove.
  if (move.type === 'finish') {
    return afterMove({ ...state, players: newPlayers, specialsOnBoard: newSpecials }, move);
  }

  // Path moves and exits route through the unified landing precedence
  // (duel → BOMB → SWAP → bridge → REWIND/STOP/KOCKA → afterMove).
  return applyLandingPrecedence(
    { ...state, specialsOnBoard: newSpecials },
    newPlayers,
    move.ring,
    move.idx,
    move.figId,
    player.color,
    false,
  );
}

function afterMove(state, _move) {
  // Placement no longer happens after a move (Rule 9.2 new — gated on 6-roll
  // via 'six-action'). Just branch on bonusRoll: Stage B if a 6 was rolled,
  // else advance to the next player.
  if (state.bonusRoll) {
    return { ...state, phase: 'rolling', diceValue: null, bonusRoll: false, rollsLeft: 1 };
  }
  return advanceTurn(state);
}

// Shared landing logic with the corrected Rule-9 precedence:
//   1. Duel on collision
//   2. BRIDGE (direct or parallel) AND can cross → Stay/Cross modal FIRST.
//        Stay → re-enters this helper with skipBridge=true → triggers special.
//        Cross → teleport, then re-enter with skipBridge=true at destination.
//   3. No bridge (or destination blocked, or skipBridge=true): walk the special
//        on THIS cell — BOMB → SWAP-own / SWAP-eligible / SWAP-fizzle → REWIND
//        → STOP → KOCKA → afterMove.
//
// Crossing the bridge means the piece never "landed" on this cell's special, so
// the special does not fire when Cross is chosen.
function applyLandingPrecedence(state, newPlayers, ring, idx, figId, playerColor, skipBridge = false) {
  // 1. Duel on collision. `skipBridge` rides along on the duel state so that
  //    after the attacker wins, the post-duel precedence at this same cell
  //    keeps the bridge step skipped — otherwise a Cross → duel → win loop
  //    would re-prompt the same bridge that just teleported the piece here.
  const occupied = findFigureOnCell(newPlayers.filter(p => p.color !== playerColor), ring, idx);
  if (occupied) {
    const duelSt = {
      atkColor: playerColor,
      defColor: occupied.player.color,
      // uids let Firestore rules authorize the defender's roll write (the
      // defender is not the current player). null in offline/hot-seat play.
      atkUid: newPlayers.find(p => p.color === playerColor)?.uid ?? null,
      defUid: occupied.player.uid ?? null,
      ring, idx, figId,
      defFigId: occupied.figure.id,
      atkRoll: null, defRoll: null,
      skipBridge,
    };
    return { ...state, players: newPlayers, duelState: duelSt, phase: 'duel' };
  }

  const spKey = `${ring}-${idx}`;
  const sp = state.specialsOnBoard[spKey];

  // 2. BRIDGE always wins precedence: Stay/Cross modal first (when present and
  //    at least one crossing destination is reachable). Multiple connecting
  //    bridges produce multiple Cross options (inner corners — see Rule 9.2).
  if (!skipBridge) {
    const connecting = getBridgesAt(ring, idx, state.bridgesOnBoard);
    const crossOptions = connecting
      .filter(b => !findFigureOnCell(
        newPlayers.filter(p => p.color === playerColor), b.other.ring, b.other.idx,
      ))
      .map(b => ({
        anchorRing: b.anchor.ring, anchorIdx: b.anchor.idx,
        otherRing: b.other.ring, otherIdx: b.other.idx,
        placedBy: b.placedBy,
      }));
    if (crossOptions.length > 0) {
      return applySpecialTrigger({ ...state, players: newPlayers }, {
        type: 'bridge', ring, idx, figId, playerColor,
        placedBy: crossOptions[0].placedBy,
        crossOptions,
        source: 'landing',
      });
    }
  }

  // 3. No bridge (or forced-Stay): fire whatever special sits on THIS cell.
  if (sp) {
    if (sp.type === 'bomb') {
      return applySpecialTrigger({ ...state, players: newPlayers }, {
        type: 'bomb', ring, idx, figId, playerColor, placedBy: sp.placedBy, source: 'landing',
      });
    }
    if (sp.type === 'swap') {
      if (sp.placedBy === playerColor) {
        return {
          ...state,
          players: newPlayers,
          phase: 'special-trigger',
          specialTrigger: { type: 'swap-own', ring, idx, figId, playerColor, placedBy: sp.placedBy },
        };
      }
      // Fires regardless of eligibility — the RESOLVE_ZAMJENA path handles the
      // "no eligible figs" case via the strip UI / random fallback.
      return applySpecialTrigger({ ...state, players: newPlayers }, {
        type: 'swap', ring, idx, figId, playerColor, placedBy: sp.placedBy, source: 'landing',
      });
    }
    if (sp.type === 'rewind' || sp.type === 'stop' || sp.type === 'dice') {
      return applySpecialTrigger({ ...state, players: newPlayers }, {
        type: sp.type, ring, idx, figId, playerColor, placedBy: sp.placedBy, source: 'landing',
      });
    }
  }

  return afterMove({ ...state, players: newPlayers }, { type: 'move', ring, idx });
}

// Back-compat wrapper for older call sites (KOCKA teleport, ZAMJENA swap).
function afterLanding(state, newPlayers, ring, idx, figId, playerColor) {
  return applyLandingPrecedence(state, newPlayers, ring, idx, figId, playerColor, false);
}

function applySpecialTrigger(state, trigger) {
  const { type, ring, idx, figId, playerColor } = trigger;
  let newPlayers = deepCopyPlayers(state.players);

  if (type === 'bomb') {
    // Instant explosion: piece goes home, bomb removed, bomb returned to placer's hand.
    const newSpecials = { ...state.specialsOnBoard };
    delete newSpecials[`${ring}-${idx}`];
    const exploder = newPlayers.find(p => p.color === playerColor);
    const fig = exploder.figures.find(f => f.id === figId);
    fig.pos = 'home';
    fig.stopActive = false;
    fig.rewindNext = false;
    fig.bombActive = null;
    exploder.specialsHeld = [...exploder.specialsHeld, 'bomb'];
    return { ...state, players: newPlayers, specialsOnBoard: newSpecials, phase: 'special-trigger', specialTrigger: trigger };
  }

  if (type === 'stop') {
    // Only reached via landing now — placement on placer's own piece is handled
    // inline in PLACE_SPECIAL (armed silently, no modal).
    const mover = newPlayers.find(p => p.color === playerColor);
    const fig = mover.figures.find(f => f.id === figId);
    fig.stopActive = true;
    return { ...state, players: newPlayers, phase: 'special-trigger', specialTrigger: trigger };
  }

  if (type === 'rewind') {
    // Only reached via landing now — same reason as 'stop' above.
    const mover = newPlayers.find(p => p.color === playerColor);
    const fig = mover.figures.find(f => f.id === figId);
    fig.rewindNext = true;
    return { ...state, players: newPlayers, phase: 'special-trigger', specialTrigger: trigger };
  }

  // MOST, KOCKA, ZAMJENA: need UI interaction — set phase
  return {
    ...state,
    players: newPlayers,
    phase: 'special-trigger',
    specialTrigger: trigger,
  };
}

function applyDuelResolve(state, atkRoll, defRoll) {
  const { duelState } = state;
  if (atkRoll === defRoll) {
    return { ...state, duelState: { ...duelState, atkRoll: null, defRoll: null } };
  }
  let newPlayers = deepCopyPlayers(state.players);
  const loserColor = atkRoll > defRoll ? duelState.defColor : duelState.atkColor;
  const loserFigId = atkRoll > defRoll ? duelState.defFigId : duelState.figId;
  const loserPlayer = newPlayers.find(p => p.color === loserColor);
  const loserFig = loserPlayer.figures.find(f => f.id === loserFigId);
  loserFig.pos = 'home';
  loserFig.stopActive = false;
  loserFig.rewindNext = false;
  loserFig.bombActive = null;
  const attackerWon = atkRoll > defRoll;
  const newState = { ...state, players: newPlayers, duelState: null };
  if (!attackerWon) return advanceTurn(newState);
  // Attacker stays on the cell — resolve any special/bridge stack via the
  // unified precedence. Inherit duelState.skipBridge so a duel born from a
  // Cross teleport doesn't re-offer the just-crossed bridge.
  return applyLandingPrecedence(
    newState,
    newPlayers,
    duelState.ring,
    duelState.idx,
    duelState.figId,
    duelState.atkColor,
    !!duelState.skipBridge,
  );
}

function reducer(state, action) {
  switch (action.type) {
    case 'ROLL_DICE': {
      // Rolling counts as an active turn — reset any pending skip-warning.
      if (state.players[state.currentPlayerIndex]?.skipCount) {
        state = { ...state, players: state.players.map((p, i) =>
          i === state.currentPlayerIndex ? { ...p, skipCount: 0 } : p
        ) };
      }
      // Consume the verifiable-roll seed (online supplies action.forcedValue
      // derived from it; offline rolls locally). Clearing it frees the lock so
      // the next roll can commit a fresh seed.
      state = { ...state, rollSeed: null };
      const val = action.forcedValue ?? rollD6();
      const player = state.players[state.currentPlayerIndex];
      const stuck = isAllStuck(player);

      let newRollsLeft = state.rollsLeft;
      if (stuck) {
        newRollsLeft = state.rollsLeft - 1;
        if (val === 6 || newRollsLeft <= 0) {
          // Got 6 or used all rolls
          const moves = getValidMoves({ ...state, diceValue: val }, val);
          if (val === 6 && moves.length > 0) {
            // Stuck player on a 6 with moves → six-action (no placements possible
            // since all pieces are in HOME or FINISH).
            return { ...state, diceValue: val, rollsLeft: newRollsLeft, phase: 'six-action', bonusRoll: true };
          }
          if (newRollsLeft <= 0) {
            return { ...state, diceValue: val, rollsLeft: 0, phase: 'no-moves' };
          }
          return { ...state, diceValue: val, rollsLeft: newRollsLeft };
        }
        return { ...state, diceValue: val, rollsLeft: newRollsLeft };
      }

      const moves = getValidMoves({ ...state, diceValue: val }, val);
      const bonus = val === 6;

      if (bonus) {
        // 6-roll: player picks ONE of [move | place | pickup] in 'six-action'.
        // Need at least one move OR at least one legal placement to enter the
        // phase — otherwise it's just an idle bonus roll.
        const placements = getPlacementMoves({ ...state, diceValue: val });
        if (moves.length === 0 && placements.length === 0) {
          return { ...state, diceValue: val, bonusRoll: true, phase: 'rolling' };
        }
        return { ...state, diceValue: val, bonusRoll: true, phase: 'six-action' };
      }

      if (moves.length === 0) {
        return { ...state, diceValue: val, bonusRoll: false, phase: 'no-moves' };
      }

      return { ...state, diceValue: val, bonusRoll: bonus, phase: 'moving' };
    }

    case 'SELECT_MOVE': {
      const move = action.move;
      return applyMove(state, move);
    }

    case 'SKIP_PLACE_SPECIAL': {
      if (state.bonusRoll) {
        return { ...state, phase: 'rolling', diceValue: null, bonusRoll: false, rollsLeft: 1 };
      }
      return advanceTurn(state);
    }

    case 'PLACE_SPECIAL': {
      const { ring, idx, specialType, bridgeAnchorRing, bridgeAnchorIdx } = action;
      const player = state.players[state.currentPlayerIndex];

      // Rule 9.2 (new): placement is gated on a 6-roll → 'six-action' phase.
      if (state.phase !== 'six-action') return state;
      if (!player.specialsHeld.includes(specialType)) return state;

      // Cell must be the current cell of one of the placer's own pieces.
      const placerFig = player.figures.find(f => figureOnPath(f.pos, ring, idx));
      if (!placerFig) return state;

      // For BRIDGE with an explicit anchor (inner-corner direction picker):
      // validate that the anchor's parallel is the piece's cell, and that
      // canPlaceMost passes for the anchor. Otherwise fall through to the
      // shared placement-target helper.
      let bridgeAnchor = null;
      if (specialType === 'bridge' && bridgeAnchorRing && bridgeAnchorIdx != null
          && !(bridgeAnchorRing === ring && bridgeAnchorIdx === idx)) {
        const parallel = getBridgeParallel(bridgeAnchorRing, bridgeAnchorIdx);
        if (!parallel || parallel.ring !== ring || parallel.idx !== idx) return state;
        if (!canPlaceMost(bridgeAnchorRing, bridgeAnchorIdx, state.bridgesOnBoard)) return state;
        bridgeAnchor = { ring: bridgeAnchorRing, idx: bridgeAnchorIdx };
      } else {
        const target = getPlacementTarget(state, player.color, placerFig.id, specialType);
        if (!target) return state;
      }

      const newPlayers = deepCopyPlayers(state.players).map(p => {
        if (p.color !== player.color) return p;
        const i = p.specialsHeld.indexOf(specialType);
        if (i !== -1) p.specialsHeld.splice(i, 1);
        return p;
      });
      const spKey = `${ring}-${idx}`;
      // Where the bridge entry is keyed in bridgesOnBoard: explicit anchor if
      // an inner-corner direction was picked, else the piece's cell.
      const anchorKey = bridgeAnchor
        ? `${bridgeAnchor.ring}-${bridgeAnchor.idx}`
        : spKey;

      // Bridges go into bridgesOnBoard, others into specialsOnBoard.
      // BRIDGE-coexistence with a non-bridge special is allowed (Rule 9.2 new).
      const newSpecials = specialType === 'bridge'
        ? state.specialsOnBoard
        : { ...state.specialsOnBoard, [spKey]: { type: specialType, placedBy: player.color } };
      const newBridges = specialType === 'bridge'
        ? { ...state.bridgesOnBoard, [anchorKey]: { placedBy: player.color } }
        : state.bridgesOnBoard;

      // Arm the placer's own piece for BOMB/STOP/REWIND (silent armed pattern).
      // The warning modal pops on the placer's next turn (bomb/stop/rewind alerts).
      if (specialType === 'bomb' || specialType === 'stop' || specialType === 'rewind') {
        const placer = newPlayers.find(p => p.color === player.color);
        const placerFigNew = placer.figures.find(f => f.id === placerFig.id);
        if (placerFigNew) {
          if (specialType === 'bomb')  placerFigNew.bombActive  = { placedBy: player.color };
          if (specialType === 'stop')   placerFigNew.stopArmed   = true;
          if (specialType === 'rewind') placerFigNew.rewindArmed = true;
        }
      }

      const baseState = { ...state, players: newPlayers, specialsOnBoard: newSpecials, bridgesOnBoard: newBridges };

      // MOST on placer's own piece — fires immediately. Build crossOptions so
      // RESOLVE_MOST can teleport on Cross. Use the updated bridges dict so the
      // just-placed bridge is included.
      if (specialType === 'bridge') {
        const connecting = getBridgesAt(ring, idx, newBridges);
        const crossOptions = connecting
          .filter(b => !findFigureOnCell(
            newPlayers.filter(p => p.color === player.color),
            b.other.ring, b.other.idx,
          ))
          .map(b => ({
            anchorRing: b.anchor.ring, anchorIdx: b.anchor.idx,
            otherRing: b.other.ring, otherIdx: b.other.idx,
            placedBy: b.placedBy,
          }));
        return applySpecialTrigger(baseState, {
          type: 'bridge',
          ring, idx,
          figId: placerFig.id,
          playerColor: player.color,
          placedBy: player.color,
          crossOptions,
          source: 'placement',
        });
      }
      if (specialType === 'dice') {
        return applySpecialTrigger(baseState, {
          type: 'dice',
          ring, idx,
          figId: placerFig.id,
          playerColor: player.color,
          placedBy: player.color,
          source: 'placement',
        });
      }

      // BOMB / STOP / REWIND (silent armed) or ZAMJENA (meaningless on self):
      // exit to Stage B (bonus re-roll). Consume bonusRoll here.
      return { ...baseState, phase: 'rolling', diceValue: null, bonusRoll: false, rollsLeft: 1, specialTrigger: null };
    }

    case 'RESOLVE_DUEL': {
      const { atkRoll, defRoll } = action;
      if (!state.duelState) return state;
      return applyDuelResolve(state, atkRoll, defRoll);
    }

    case 'DUEL_SET_ROLL': {
      const { who, roll } = action;
      if (!state.duelState) return state;
      return { ...state, duelState: { ...state.duelState, [who === 'atk' ? 'atkRoll' : 'defRoll']: roll } };
    }

    case 'FORCE_DUEL_TIMEOUT': {
      // Timer expired with at least one missing roll.
      // Rule: a side that didn't roll forfeits. If neither rolled, attacker wins.
      if (!state.duelState) return state;
      const ds = state.duelState;
      if (ds.atkRoll !== null && ds.defRoll !== null) return state; // both rolled — race guard
      const atkWins = ds.atkRoll !== null || ds.defRoll === null;
      // Synthesize rolls so applyDuelResolve drives the right winner.
      const fakeAtk = atkWins ? 6 : 1;
      const fakeDef = atkWins ? 1 : 6;
      return applyDuelResolve(state, fakeAtk, fakeDef);
    }

    case 'RESOLVE_MOST': {
      const { cross, trigger, crossOptionIdx } = action;
      if (!cross) {
        // Stay — re-run the landing precedence WITHOUT the bridge step so any
        // non-bridge special (BOMB / SWAP / REWIND / STOP / KOCKA) on this cell
        // triggers now. The piece position hasn't changed.
        return applyLandingPrecedence(
          { ...state, specialTrigger: null },
          state.players,
          trigger.ring, trigger.idx,
          trigger.figId, trigger.playerColor,
          true,
        );
      }

      // Cross: pick the chosen option (defaults to first when only one exists).
      const opts = trigger.crossOptions || [];
      const picked = opts[crossOptionIdx ?? 0];
      if (!picked) {
        return afterMove({ ...state, specialTrigger: null }, { type: 'move', ring: trigger.ring, idx: trigger.idx });
      }
      const destRing = picked.otherRing;
      const destIdx = picked.otherIdx;

      // Re-check own-piece blocking — state may have shifted since trigger.
      const ownBlocksDest = state.players
        .filter(p => p.color === trigger.playerColor)
        .some(p => p.figures.some(f => f.id !== trigger.figId && figureOnPath(f.pos, destRing, destIdx)));
      if (ownBlocksDest) {
        return afterMove({ ...state, specialTrigger: null }, { type: 'move', ring: trigger.ring, idx: trigger.idx });
      }

      let newPlayers = deepCopyPlayers(state.players);
      const mover = newPlayers.find(p => p.color === trigger.playerColor);
      const fig = mover.figures.find(f => f.id === trigger.figId);
      fig.pos = { ring: destRing, idx: destIdx };

      // Resolve specials at destination using the unified precedence. Skip the
      // bridge step at destination to avoid looping right back across.
      return applyLandingPrecedence(
        { ...state, specialTrigger: null },
        newPlayers,
        destRing,
        destIdx,
        trigger.figId,
        trigger.playerColor,
        true,
      );
    }

    case 'RESOLVE_KOCKA': {
      const { trigger, d1, d2 } = action;
      const total = d1 + d2;
      const player = state.players[state.currentPlayerIndex];
      const pd = playerDef(player.color);
      const len = pathLen(trigger.ring);
      const cancelState = { ...state, specialTrigger: null, secondDiceValue: d1 * 10 + d2 };

      let newPlayers = deepCopyPlayers(state.players);
      const mover = newPlayers.find(p => p.color === trigger.playerColor);
      const fig = mover.figures.find(f => f.id === trigger.figId);

      if (trigger.ring === 'inner') {
        const stepsToFinish = (pd.finishEntryIdx - trigger.idx + len) % len;
        if (total <= stepsToFinish) {
          const targetIdx = advanceCW(trigger.idx, total, len);
          const selfBlocked = mover.figures.some(f => f.id !== fig.id && typeof f.pos === 'object' && f.pos.ring === 'inner' && f.pos.idx === targetIdx);
          if (selfBlocked) return advanceTurn(cancelState);
          fig.pos = { ring: 'inner', idx: targetIdx };
        } else {
          const slot = total - stepsToFinish;
          if (slot >= 1 && slot <= 4) {
            if (findFigureInFinish(state.players, player.color, 'finish', slot)) return advanceTurn(cancelState);
            fig.pos = { lane: 'finish', color: player.color, slot };
          } else {
            // Overshoot — no valid destination, cancel
            return advanceTurn(cancelState);
          }
        }
      } else {
        const targetIdx = advanceCW(trigger.idx, total, len);
        const selfBlocked = mover.figures.some(f => f.id !== fig.id && typeof f.pos === 'object' && f.pos.ring === 'outer' && f.pos.idx === targetIdx);
        if (selfBlocked) return advanceTurn(cancelState);
        fig.pos = { ring: 'outer', idx: targetIdx };
      }

      const newState = { ...state, players: newPlayers, specialTrigger: null, secondDiceValue: d1 * 10 + d2 };
      if (typeof fig.pos === 'object' && fig.pos.ring) {
        return afterLanding(newState, newPlayers, fig.pos.ring, fig.pos.idx, trigger.figId, trigger.playerColor);
      }
      // Landed in finish — no collision possible
      return afterMove(newState, { type: 'move', ring: trigger.ring, idx: trigger.idx });
    }

    case 'DISMISS_SPECIAL_INFO': {
      const trigger = state.specialTrigger;
      const newState = { ...state, specialTrigger: null };
      if (trigger?.type === 'swap-own') {
        return afterMove(newState, { type: 'move', ring: trigger.ring, idx: trigger.idx });
      }
      // Bomb blew up the current player's own piece — forfeit the bonus roll
      if (trigger?.type === 'bomb' && trigger.playerColor === state.players[state.currentPlayerIndex].color) {
        return advanceTurn({ ...newState, bonusRoll: false });
      }
      if (newState.bonusRoll) {
        return { ...newState, phase: 'rolling', diceValue: null, bonusRoll: false, rollsLeft: 1 };
      }
      return advanceTurn(newState);
    }

    case 'RESOLVE_ZAMJENA': {
      const { trigger, targetColor, targetFigId } = action;
      // Rule 9.f: target must belong to the player who PLACED the swap.
      if (!trigger || trigger.type !== 'swap') return state;
      // null/null = "skip" (no eligible target or user pressed ✕). Allow it
      // through so afterMove fires and the game progresses; the swap simply
      // doesn't happen (swapped stays false below).
      if (targetColor !== null && targetColor !== trigger.placedBy) return state;
      let newPlayers = deepCopyPlayers(state.players);
      const mover = newPlayers.find(p => p.color === trigger.playerColor);
      const myFig = mover.figures.find(f => f.id === trigger.figId);
      const targetPlayer = newPlayers.find(p => p.color === targetColor);
      let swapped = false;
      if (targetPlayer) {
        const targetFig = targetPlayer.figures.find(f => f.id === targetFigId);
        if (targetFig && typeof targetFig.pos === 'object' && targetFig.pos.ring) {
          const oldPos = myFig.pos;
          myFig.pos = targetFig.pos;
          targetFig.pos = oldPos;
          // Both figures moved — clear their status flags
          myFig.stopActive = false;
          myFig.rewindNext = false;
          myFig.bombActive = null;
          targetFig.stopActive = false;
          targetFig.rewindNext = false;
          targetFig.bombActive = null;
          swapped = true;
        }
      }
      const baseState = { ...state, players: newPlayers, specialTrigger: null };
      // Check specials/collision at the active figure's new position
      if (swapped && typeof myFig.pos === 'object' && myFig.pos.ring) {
        return afterLanding(baseState, newPlayers, myFig.pos.ring, myFig.pos.idx, trigger.figId, trigger.playerColor);
      }
      return afterMove(baseState, { type: 'move', ring: trigger.ring, idx: trigger.idx });
    }

    case 'END_TURN': {
      return advanceTurn(state);
    }

    case 'SKIP_PLAYER_TURN': {
      // Skip the absent active player. Carries `color` so out-of-date clients
      // can no-op when another client already advanced the turn.
      const { color } = action;
      const idx = state.currentPlayerIndex;
      const current = state.players[idx];
      if (!current || current.color !== color) return state;
      const players = state.players.map((p, i) =>
        i === idx ? { ...p, skipCount: (p.skipCount ?? 0) + 1 } : p
      );
      return advanceTurn({ ...state, players });
    }

    case 'INITIAL_ROLL': {
      const { initialRollOrder, initialRollIdx, initialRolls } = state;
      if (initialRollIdx >= initialRollOrder.length) return state;
      const color = initialRollOrder[initialRollIdx];
      // Rolling is activity — reset any pending skip-warning for this player.
      const rollerIdx = state.players.findIndex(p => p.color === color);
      if (rollerIdx >= 0 && state.players[rollerIdx]?.skipCount) {
        state = { ...state, players: state.players.map((p, i) =>
          i === rollerIdx ? { ...p, skipCount: 0 } : p
        ) };
      }
      const val = rollD6();
      const newRolls = { ...initialRolls, [color]: val };
      const nextIdx = initialRollIdx + 1;

      if (nextIdx < initialRollOrder.length) {
        return { ...state, initialRolls: newRolls, initialRollIdx: nextIdx };
      }

      // All players in this round have rolled
      const maxVal = Math.max(...Object.values(newRolls));
      const tied = initialRollOrder.filter(c => newRolls[c] === maxVal);

      if (tied.length === 1) {
        return { ...state, initialRolls: newRolls, initialRollIdx: nextIdx, initialRollWinner: tied[0] };
      }
      // Tie — show results then wait for user to continue
      return { ...state, initialRolls: newRolls, initialRollIdx: nextIdx, initialRollOrder: tied, initialRollTied: true };
    }

    case 'CONTINUE_AFTER_TIE': {
      return { ...state, initialRolls: {}, initialRollIdx: 0, initialRollTied: false };
    }

    case 'START_GAME': {
      const winnerIdx = state.players.findIndex(p => p.color === state.initialRollWinner);
      const winner = state.players[winnerIdx];
      // Snapshot the starting roster so DNF entries can still render names
      // after REMOVE_PLAYER strips kicked players from `players`.
      const allColors = state.players.map(p => p.color);
      const initialNames = Object.fromEntries(state.players.map(p => [p.color, p.name]));
      return {
        ...state,
        phase: 'rolling',
        currentPlayerIndex: winnerIdx,
        rollsLeft: isAllStuck(winner) ? 3 : 1,
        initialRollWinner: null,
        allColors,
        initialNames,
      };
    }

    case 'KOCKA_SET_ROLL': {
      if (!state.specialTrigger || state.specialTrigger.type !== 'dice') return state;
      return { ...state, specialTrigger: { ...state.specialTrigger, d1: action.d1, d2: action.d2 } };
    }

    case 'SYNC':
      return action.state;

    case 'REMOVE_PLAYER': {
      if (state.phase === 'game-over') return state;
      const { color } = action;
      const removedIdx = state.players.findIndex(p => p.color === color);
      if (removedIdx === -1) return state;

      const newPlayers = state.players.filter(p => p.color !== color);
      const newSpecials = Object.fromEntries(
        Object.entries(state.specialsOnBoard).filter(([, v]) => v.placedBy !== color)
      );
      const newBridges = Object.fromEntries(
        Object.entries(state.bridgesOnBoard).filter(([, v]) => v.placedBy !== color)
      );

      const standings = state.standings || [];
      if (newPlayers.length === 0) {
        return {
          ...state,
          players: newPlayers,
          specialsOnBoard: newSpecials,
          bridgesOnBoard: newBridges,
          currentPlayerIndex: 0,
          phase: 'game-over',
          duelState: null,
          specialTrigger: null,
        };
      }
      // Sole survivor who has ALREADY finished → game-over. If they haven't
      // finished yet, the user wants them to keep playing alone until they do.
      if (newPlayers.length === 1 && standings.includes(newPlayers[0].color)) {
        return {
          ...state,
          players: newPlayers,
          specialsOnBoard: newSpecials,
          bridgesOnBoard: newBridges,
          currentPlayerIndex: 0,
          phase: 'game-over',
          duelState: null,
          specialTrigger: null,
        };
      }

      // Handle initial-roll phase: remove from roll order
      if (state.phase === 'initial-roll') {
        const newOrder = state.initialRollOrder.filter(c => c !== color);
        const newRolls = Object.fromEntries(
          Object.entries(state.initialRolls).filter(([c]) => c !== color)
        );
        if (newOrder.length === 0) {
          return {
            ...state,
            players: newPlayers,
            specialsOnBoard: newSpecials,
            bridgesOnBoard: newBridges,
            phase: 'rolling',
            currentPlayerIndex: 0,
            rollsLeft: isAllStuck(newPlayers[0]) ? 3 : 1,
            initialRollOrder: newOrder,
            initialRolls: newRolls,
            initialRollIdx: 0,
          };
        }
        const removedOrderIdx = state.initialRollOrder.indexOf(color);
        let newRollIdx = state.initialRollIdx;
        if (removedOrderIdx !== -1 && removedOrderIdx < state.initialRollIdx) newRollIdx--;
        else if (removedOrderIdx === state.initialRollIdx) newRollIdx = removedOrderIdx % newOrder.length;
        return {
          ...state,
          players: newPlayers,
          specialsOnBoard: newSpecials,
          bridgesOnBoard: newBridges,
          initialRollOrder: newOrder,
          initialRolls: newRolls,
          initialRollIdx: Math.min(newRollIdx, newOrder.length),
        };
      }

      let newCurrentIdx = state.currentPlayerIndex;
      if (removedIdx < state.currentPlayerIndex) newCurrentIdx--;
      else if (removedIdx === state.currentPlayerIndex) newCurrentIdx = removedIdx % newPlayers.length;

      const wasActive = removedIdx === state.currentPlayerIndex;
      const inDuel = !!state.duelState &&
        (state.duelState.atkColor === color || state.duelState.defColor === color);

      if (wasActive || inDuel) {
        const nextPlayer = newPlayers[newCurrentIdx];
        return {
          ...state,
          players: newPlayers,
          specialsOnBoard: newSpecials,
          bridgesOnBoard: newBridges,
          currentPlayerIndex: newCurrentIdx,
          diceValue: null,
          secondDiceValue: null,
          rollsLeft: isAllStuck(nextPlayer) ? 3 : 1,
          bonusRoll: false,
          phase: 'rolling',
          duelState: null,
          specialTrigger: null,
        };
      }

      return {
        ...state,
        players: newPlayers,
        specialsOnBoard: newSpecials,
        bridgesOnBoard: newBridges,
        currentPlayerIndex: newCurrentIdx,
      };
    }

    default:
      return state;
  }
}

export { reducer, initState };

export function useGame(setupPlayers) {
  const [state, dispatch] = useReducer(reducer, setupPlayers, initState);

  const rollDice = useCallback(() => dispatch({ type: 'ROLL_DICE' }), []);
  const selectMove = useCallback(move => dispatch({ type: 'SELECT_MOVE', move }), []);
  const skipPlaceSpecial = useCallback(() => dispatch({ type: 'SKIP_PLACE_SPECIAL' }), []);
  const placeSpecial = useCallback((ring, idx, specialType, bridgeAnchorRing, bridgeAnchorIdx) =>
    dispatch({ type: 'PLACE_SPECIAL', ring, idx, specialType, bridgeAnchorRing, bridgeAnchorIdx }), []);
  const resolveDuel = useCallback((atkRoll, defRoll) =>
    dispatch({ type: 'RESOLVE_DUEL', atkRoll, defRoll }), []);
  const duelSetRoll = useCallback((who, roll) =>
    dispatch({ type: 'DUEL_SET_ROLL', who, roll }), []);
  const forceDuelTimeout = useCallback(() =>
    dispatch({ type: 'FORCE_DUEL_TIMEOUT' }), []);
  const resolveMost = useCallback((cross, trigger, crossOptionIdx) =>
    dispatch({ type: 'RESOLVE_MOST', cross, trigger, crossOptionIdx }), []);
  const resolveKocka = useCallback((trigger, d1, d2) =>
    dispatch({ type: 'RESOLVE_KOCKA', trigger, d1, d2 }), []);
  const kockaSetRoll = useCallback((d1, d2) => dispatch({ type: 'KOCKA_SET_ROLL', d1, d2 }), []);
  const resolveZamjena = useCallback((trigger, targetColor, targetFigId) =>
    dispatch({ type: 'RESOLVE_ZAMJENA', trigger, targetColor, targetFigId }), []);
  const dismissSpecialInfo = useCallback(() => dispatch({ type: 'DISMISS_SPECIAL_INFO' }), []);
  const endTurn = useCallback(() => dispatch({ type: 'END_TURN' }), []);
  const skipPlayerTurn = useCallback((color) =>
    dispatch({ type: 'SKIP_PLAYER_TURN', color }), []);
  const removePlayer = useCallback((color) =>
    dispatch({ type: 'REMOVE_PLAYER', color }), []);
  const initialRoll = useCallback(() => dispatch({ type: 'INITIAL_ROLL' }), []);
  const continueAfterTie = useCallback(() => dispatch({ type: 'CONTINUE_AFTER_TIE' }), []);
  const startGame = useCallback(() => dispatch({ type: 'START_GAME' }), []);

  const validMoves = (state.phase === 'moving' || state.phase === 'six-action')
    ? getValidMoves(state, state.diceValue)
    : [];

  const placementMoves = state.phase === 'six-action'
    ? getPlacementMoves(state)
    : [];

  const currentPlayer = state.players[state.currentPlayerIndex];

  return {
    state,
    currentPlayer,
    validMoves,
    placementMoves,
    rollDice,
    selectMove,
    skipPlaceSpecial,
    placeSpecial,
    resolveDuel,
    duelSetRoll,
    forceDuelTimeout,
    resolveMost,
    resolveKocka,
    kockaSetRoll,
    resolveZamjena,
    dismissSpecialInfo,
    endTurn,
    skipPlayerTurn,
    removePlayer,
    initialRoll,
    continueAfterTie,
    startGame,
  };
}