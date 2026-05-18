// Board: 19×19 CSS grid
// Outer ring: perimeter of 19×19 (72 cells, clockwise)
// Inner ring: perimeter of 13×13 area at rows 3-15, cols 3-15 (48 cells, clockwise)
// Margin (rows 1-2, 16-17, cols 1-2, 16-17): HOME areas
// Inside inner ring (rows 4-14, cols 4-14): finish lanes + center

// --- Outer path (72 cells, clockwise starting [0,0]) ---
function buildOuterPath() {
  const path = [];
  // Top: left → right (row 0, col 0..18)
  for (let c = 0; c <= 18; c++) path.push({ r: 0, c });
  // Right: top → bottom (col 18, row 1..18)
  for (let r = 1; r <= 18; r++) path.push({ r, c: 18 });
  // Bottom: right → left (row 18, col 17..0)
  for (let c = 17; c >= 0; c--) path.push({ r: 18, c });
  // Left: bottom → top (col 0, row 17..1)
  for (let r = 17; r >= 1; r--) path.push({ r, c: 0 });
  return path; // 72 cells (indices 0-71)
}

// --- Inner path (48 cells, clockwise starting [3,3]) ---
function buildInnerPath() {
  const path = [];
  // Top: left → right (row 3, col 3..15)
  for (let c = 3; c <= 15; c++) path.push({ r: 3, c });
  // Right: top → bottom (col 15, row 4..15)
  for (let r = 4; r <= 15; r++) path.push({ r, c: 15 });
  // Bottom: right → left (row 15, col 14..3)
  for (let c = 14; c >= 3; c--) path.push({ r: 15, c });
  // Left: bottom → top (col 3, row 14..4)
  for (let r = 14; r >= 4; r--) path.push({ r, c: 3 });
  return path; // 48 cells (indices 0-47)
}

export const OUTER_PATH = buildOuterPath();
export const INNER_PATH = buildInnerPath();

// Advance index clockwise by `steps` on a path of length `len`
export function advanceCW(idx, steps, len) {
  return (idx + steps) % len;
}
// Advance index counter-clockwise (REWIND)
export function advanceCCW(idx, steps, len) {
  return (idx - steps + len) % len;
}

// --- Player definitions ---
// exitOuter / exitInner: index on path where figure appears when leaving HOME
// finishEntryIdx: index on INNER_PATH where figure is standing when it can enter the finish lane
//   (figure at this index rolls exact 1 → enters finishCells[0], slot 1)
// finishCells: [{r,c}] length 4, slot 1 = closest to path, slot 4 = deepest (win position)
// homeCells: [{r,c}] the 4 cells in HOME area
// color: CSS hex
// mostPairs: [{outerIdx, innerIdx}] — pairs of outer/inner path indices that are 1 cell apart

export const PLAYERS = {
  red: {
    color: '#e53935',
    colorVar: '--color-red',
    homeCells: [{ r: 1, c: 1 }, { r: 1, c: 2 }, { r: 2, c: 1 }, { r: 2, c: 2 }],
    exitOuter: 69,       // outer[69] = [3,0]  (col 1, row 4 — 1-indexed)
    exitInner: 0,        // inner[0]  = [3,3]  (top-left corner of inner ring)
    finishEntryIdx: 47,  // inner[47] = [4,3] → 1 step before exit
    finishCells: [{ r: 4, c: 4 }, { r: 5, c: 4 }, { r: 6, c: 4 }, { r: 7, c: 4 }],
    mostPairs: [{ outerIdx: 71, innerIdx: 47 }, { outerIdx: 0, innerIdx: 0 }],
  },
  yellow: {
    color: '#fdd835',
    colorVar: '--color-yellow',
    homeCells: [{ r: 1, c: 10 }, { r: 1, c: 11 }, { r: 2, c: 10 }, { r: 2, c: 11 }],
    exitOuter: 9,        // outer[9]  = [0,9]   (row 1, col 10)
    exitInner: 6,        // inner[6]  = [3,9]   (row 4, col 10)
    finishEntryIdx: 5,   // inner[5]  = [3,8]   (one step before exit, CW)
    finishCells: [{ r: 4, c: 8 }, { r: 5, c: 8 }, { r: 6, c: 8 }, { r: 7, c: 8 }],
    mostPairs: [{ outerIdx: 8, innerIdx: 6 }, { outerIdx: 9, innerIdx: 7 }],
  },
  blue: {
    color: '#1e88e5',
    colorVar: '--color-blue',
    homeCells: [{ r: 1, c: 16 }, { r: 1, c: 17 }, { r: 2, c: 16 }, { r: 2, c: 17 }],
    exitOuter: 15,       // outer[15] = [0,15]  (row 1, col 16)
    exitInner: 12,       // inner[12] = [3,15]  (row 4, col 16)
    finishEntryIdx: 11,  // inner[11] = [3,14]
    finishCells: [{ r: 4, c: 14 }, { r: 4, c: 13 }, { r: 4, c: 12 }, { r: 4, c: 11 }],
    mostPairs: [{ outerIdx: 16, innerIdx: 10 }, { outerIdx: 17, innerIdx: 11 }],
  },
  magenta: {
    color: '#f06292',
    colorVar: '--color-magenta',
    homeCells: [{ r: 10, c: 16 }, { r: 10, c: 17 }, { r: 11, c: 16 }, { r: 11, c: 17 }],
    exitOuter: 27,       // outer[27] = [9,18]  (row 10, col 19)
    exitInner: 18,       // inner[18] = [9,15]  (row 10, col 16)
    finishEntryIdx: 17,  // inner[17] = [8,15]  (one step before exit, CW)
    finishCells: [{ r: 8, c: 14 }, { r: 8, c: 13 }, { r: 8, c: 12 }, { r: 8, c: 11 }],
    mostPairs: [{ outerIdx: 26, innerIdx: 18 }, { outerIdx: 27, innerIdx: 19 }],
  },
  orange: {
    color: '#fb8c00',
    colorVar: '--color-orange',
    homeCells: [{ r: 16, c: 16 }, { r: 16, c: 17 }, { r: 17, c: 16 }, { r: 17, c: 17 }],
    exitOuter: 33,       // outer[33] = [15,18]  (row 16, col 19)
    exitInner: 24,       // inner[24] = [15,15]  (row 16, col 16)
    finishEntryIdx: 23,  // inner[23] = [14,15]  (one step before exit, CW)
    finishCells: [{ r: 14, c: 14 }, { r: 13, c: 14 }, { r: 12, c: 14 }, { r: 11, c: 14 }],
    mostPairs: [{ outerIdx: 36, innerIdx: 24 }, { outerIdx: 37, innerIdx: 25 }],
  },
  purple: {
    color: '#8e24aa',
    colorVar: '--color-purple',
    homeCells: [{ r: 16, c: 7 }, { r: 16, c: 8 }, { r: 17, c: 7 }, { r: 17, c: 8 }],
    exitOuter: 45,       // outer[45] = [18,9]   (row 19, col 10)
    exitInner: 30,       // inner[30] = [15,9]   (row 16, col 10)
    finishEntryIdx: 29,  // inner[29] = [15,10]  (one step before exit, CW)
    finishCells: [{ r: 14, c: 10 }, { r: 13, c: 10 }, { r: 12, c: 10 }, { r: 11, c: 10 }],
    mostPairs: [{ outerIdx: 44, innerIdx: 30 }, { outerIdx: 45, innerIdx: 31 }],
  },
  cyan: {
    color: '#00838f',
    colorVar: '--color-cyan',
    homeCells: [{ r: 16, c: 1 }, { r: 16, c: 2 }, { r: 17, c: 1 }, { r: 17, c: 2 }],
    exitOuter: 51,       // outer[51] = [18,3]   (row 19, col 4)
    exitInner: 36,       // inner[36] = [15,3]   (row 16, col 4)
    finishEntryIdx: 35,  // inner[35] = [15,4]   (one step before exit, CW)
    finishCells: [{ r: 14, c: 4 }, { r: 14, c: 5 }, { r: 14, c: 6 }, { r: 14, c: 7 }],
    mostPairs: [{ outerIdx: 54, innerIdx: 36 }, { outerIdx: 55, innerIdx: 37 }],
  },
  green: {
    color: '#43a047',
    colorVar: '--color-green',
    homeCells: [{ r: 7, c: 1 }, { r: 7, c: 2 }, { r: 8, c: 1 }, { r: 8, c: 2 }],
    exitOuter: 63,       // outer[63] = [9,0]    (row 10, col 1)
    exitInner: 42,       // inner[42] = [9,3]    (row 10, col 4)
    finishEntryIdx: 41,  // inner[41] = [10,3]   (one step before exit, CW)
    finishCells: [{ r: 10, c: 4 }, { r: 10, c: 5 }, { r: 10, c: 6 }, { r: 10, c: 7 }],
    mostPairs: [{ outerIdx: 62, innerIdx: 42 }, { outerIdx: 63, innerIdx: 43 }],
  },
};

export const PLAYER_ORDER = ['red', 'yellow', 'blue', 'magenta', 'orange', 'purple', 'cyan', 'green'];

// Build a fast lookup: "r,c" -> cell descriptor
function buildGrid() {
  const grid = Array.from({ length: 19 }, () =>
    Array.from({ length: 19 }, () => ({ type: 'empty' }))
  );

  // Outer path cells
  OUTER_PATH.forEach(({ r, c }, idx) => {
    grid[r][c] = { type: 'outer-path', outerIdx: idx };
  });

  // Inner path cells
  INNER_PATH.forEach(({ r, c }, idx) => {
    grid[r][c] = { type: 'inner-path', innerIdx: idx };
  });

  // Center area (inside inner ring, not finish)
  for (let r = 4; r <= 14; r++) {
    for (let c = 4; c <= 14; c++) {
      if (grid[r][c].type === 'empty') {
        grid[r][c] = { type: 'center' };
      }
    }
  }

  // Player HOME cells, finish cells
  Object.entries(PLAYERS).forEach(([colorKey, p]) => {
    p.homeCells.forEach(({ r, c }, i) => {
      grid[r][c] = { type: 'home', color: colorKey, homeSlot: i };
    });
    p.finishCells.forEach(({ r, c }, i) => {
      grid[r][c] = { type: 'finish', color: colorKey, slot: i + 1 };
    });
  });

  return grid;
}

export const GRID = buildGrid();

// Special square types
export const SPECIAL_TYPES = ['most', 'kocka', 'rewind', 'bomba', 'stop', 'zamjena'];

// Distribute specials: floor(8 / numPlayers) of each type per player
export function distributeSpecials(numPlayers) {
  const perPlayer = Math.floor(8 / numPlayers);
  const hand = [];
  SPECIAL_TYPES.forEach(type => {
    for (let i = 0; i < perPlayer; i++) hand.push(type);
  });
  return hand;
}

function isHomeCell(r, c) {
  if (r < 0 || r > 18 || c < 0 || c > 18) return false;
  return GRID[r][c].type === 'home';
}

// Find the parallel cell on the other ring for a bridge.
// A bridge connects an outer-ring cell to the inner-ring cell directly across the margin,
// unless a HOME cell sits in between. Returns {ring, idx} or null.
// Index formulas (clockwise path layout):
//   Outer: top idx=c, right idx=18+r, bottom idx=54-c, left idx=72-r
//   Inner: top idx=c-3, right idx=9+r, bottom idx=39-c, left idx=51-r
export function getBridgeParallel(ring, idx) {
  const { r, c } = ring === 'outer' ? OUTER_PATH[idx] : INNER_PATH[idx];

  if (ring === 'outer') {
    if (r === 0 && c >= 3 && c <= 15) {
      if (isHomeCell(1, c) || isHomeCell(2, c)) return null;
      return { ring: 'inner', idx: c - 3 };
    }
    if (c === 18 && r >= 4 && r <= 15) {
      if (isHomeCell(r, 16) || isHomeCell(r, 17)) return null;
      return { ring: 'inner', idx: 9 + r };
    }
    if (r === 18 && c >= 3 && c <= 14) {
      if (isHomeCell(16, c) || isHomeCell(17, c)) return null;
      return { ring: 'inner', idx: 39 - c };
    }
    if (c === 0 && r >= 4 && r <= 14) {
      if (isHomeCell(r, 1) || isHomeCell(r, 2)) return null;
      return { ring: 'inner', idx: 51 - r };
    }
    return null;
  } else {
    if (r === 3 && c >= 3 && c <= 15) {
      if (isHomeCell(1, c) || isHomeCell(2, c)) return null;
      return { ring: 'outer', idx: c };
    }
    if (c === 15 && r >= 4 && r <= 15) {
      if (isHomeCell(r, 16) || isHomeCell(r, 17)) return null;
      return { ring: 'outer', idx: 18 + r };
    }
    if (r === 15 && c >= 3 && c <= 14) {
      if (isHomeCell(16, c) || isHomeCell(17, c)) return null;
      return { ring: 'outer', idx: 54 - c };
    }
    if (c === 3 && r >= 4 && r <= 14) {
      if (isHomeCell(r, 1) || isHomeCell(r, 2)) return null;
      return { ring: 'outer', idx: 72 - r };
    }
    return null;
  }
}

// Check if a MOST bridge can be placed at (ring, idx).
// Returns the destination {ring, idx} on success, or null if invalid.
export function canPlaceMost(ring, idx, bridgesOnBoard) {
  if (bridgesOnBoard?.[`${ring}-${idx}`]) return null;
  const dest = getBridgeParallel(ring, idx);
  if (!dest) return null;
  if (bridgesOnBoard?.[`${dest.ring}-${dest.idx}`]) return null;
  return dest;
}

// Check if a cell can receive a special square (rule 9.2).
// activeColors: array of color strings for players currently in the game.
// Blocked if the cell is an active player's HOME-exit cell (spawn point) on
// either ring. Finish-entry cells are NOT blocked — the rule prohibits placing
// only on the exit FROM home, not the entry INTO finish.
export function canPlaceSpecial(ring, idx, activeColors) {
  const { r, c } = ring === 'outer' ? OUTER_PATH[idx] : INNER_PATH[idx];
  const cell = GRID[r][c];
  if (cell.type !== 'outer-path' && cell.type !== 'inner-path') return false;
  const colors = activeColors || Object.keys(PLAYERS);
  for (const color of colors) {
    const p = PLAYERS[color];
    if (!p) continue;
    if (ring === 'outer' && idx === p.exitOuter) return false;
    if (ring === 'inner' && idx === p.exitInner) return false;
  }
  return true;
}