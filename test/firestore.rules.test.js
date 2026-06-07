// Firestore security-rules tests for the turn-ownership + structural-integrity
// hardening. Run via:  npm run test:rules
// (firebase emulators:exec spins up the Firestore emulator around this file).
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'demo-ludo-rules';
let testEnv;

// Authenticated client for a uid, with the @gmail.com token the rules demand.
function db(uid) {
  return testEnv
    .authenticatedContext(uid, { email: `${uid}@gmail.com`, email_verified: true })
    .firestore();
}

const ROOM = 'room1';
const ref = (fdb) => doc(fdb, 'rooms', ROOM);

// Three seats: host H at index 0 (so seat0 == host), current player C at
// index 1, other player O at index 2.
function players() {
  return [
    { uid: 'H', color: 'red', name: 'H', figures: [], specialsHeld: [], skipCount: 0 },
    { uid: 'C', color: 'blue', name: 'C', figures: [], specialsHeld: [], skipCount: 0 },
    { uid: 'O', color: 'green', name: 'O', figures: [], specialsHeld: [], skipCount: 0 },
  ];
}

function gameState(overrides = {}) {
  return {
    players: players(),
    currentPlayerIndex: 1, // C
    diceValue: null,
    secondDiceValue: null,
    rollsLeft: 1,
    bonusRoll: false,
    phase: 'rolling',
    specialsOnBoard: {},
    bridgesOnBoard: {},
    duelState: null,
    specialTrigger: null,
    standings: [],
    allColors: ['red', 'blue', 'green'],
    initialNames: {},
    initialRollOrder: ['red', 'blue', 'green'],
    initialRolls: {},
    initialRollIdx: 0,
    initialRollWinner: null,
    initialRollTied: false,
    ...overrides,
  };
}

function room(overrides = {}) {
  return {
    code: 'ABC123',
    hostUid: 'H',
    status: 'active',
    players: players(),
    playerUids: ['H', 'C', 'O'],
    gameState: gameState(),
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

async function seed(docData) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(ref(ctx.firestore()), docData);
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('turn ownership', () => {
  it('current player may make a move (consume the die, advance turn)', async () => {
    // A move keeps or clears diceValue (a new value must come from the roll
    // flow); here the current player consumes their roll and hands off.
    await seed(room({ gameState: gameState({ diceValue: 5, phase: 'moving' }) }));
    await assertSucceeds(
      updateDoc(ref(db('C')), { gameState: gameState({ diceValue: null, phase: 'rolling', currentPlayerIndex: 2 }) })
    );
  });

  it('non-current player may NOT make a move', async () => {
    await seed(room({ gameState: gameState({ diceValue: 5, phase: 'moving' }) }));
    await assertFails(
      updateDoc(ref(db('O')), { gameState: gameState({ diceValue: null, phase: 'rolling', currentPlayerIndex: 2 }) })
    );
  });

  it('a non-member may not write at all', async () => {
    await seed(room());
    await assertFails(
      updateDoc(ref(db('stranger')), { gameState: gameState({ diceValue: 5 }) })
    );
  });
});

// Seed used across verifiable-roll tests. 1000003 % 6 === 1 → single-die value 2;
// floor(1000003 / 6) % 6 === 5 → KOCKA d2 value 6.
const SEED_MS = 1000003;
const DIE = (SEED_MS % 6) + 1;                       // 2
const D2 = (Math.floor(SEED_MS / 6) % 6) + 1;        // 6
const seedTs = () => Timestamp.fromMillis(SEED_MS);

describe('duel (verifiable, serialized)', () => {
  // attacker rolled (3); defender about to roll; a seed is committed.
  const duelAwaitingDef = () =>
    gameState({
      phase: 'duel',
      rollSeed: seedTs(),
      duelState: { atkColor: 'blue', defColor: 'green', atkUid: 'C', defUid: 'O', atkRoll: 3, defRoll: null },
    });

  it('defender derives their roll from the committed seed', async () => {
    await seed(room({ gameState: duelAwaitingDef() }));
    const next = duelAwaitingDef();
    next.rollSeed = null;
    next.duelState = { ...next.duelState, defRoll: DIE };
    await assertSucceeds(updateDoc(ref(db('O')), { gameState: next }));
  });

  it('defender cannot forge a roll value', async () => {
    await seed(room({ gameState: duelAwaitingDef() }));
    const next = duelAwaitingDef();
    next.rollSeed = null;
    next.duelState = { ...next.duelState, defRoll: 6 }; // wrong (should be DIE)
    await assertFails(updateDoc(ref(db('O')), { gameState: next }));
  });

  it('defender may NOT tamper with the roster while rolling', async () => {
    await seed(room({ gameState: duelAwaitingDef() }));
    const tampered = duelAwaitingDef();
    tampered.rollSeed = null;
    tampered.duelState = { ...tampered.duelState, defRoll: DIE };
    tampered.players = players().map((p) => (p.uid === 'O' ? { ...p, color: 'magenta' } : p));
    await assertFails(updateDoc(ref(db('O')), { gameState: tampered }));
  });

  it('attacker derives their roll first (atkRoll from seed)', async () => {
    const pre = gameState({
      phase: 'duel',
      rollSeed: seedTs(),
      duelState: { atkColor: 'blue', defColor: 'green', atkUid: 'C', defUid: 'O', atkRoll: null, defRoll: null },
    });
    await seed(room({ gameState: pre }));
    const next = { ...pre, rollSeed: null, duelState: { ...pre.duelState, atkRoll: DIE } };
    await assertSucceeds(updateDoc(ref(db('C')), { gameState: next }));
  });

  it('defender may not roll before the attacker (serialization)', async () => {
    const pre = gameState({
      phase: 'duel',
      rollSeed: seedTs(),
      duelState: { atkColor: 'blue', defColor: 'green', atkUid: 'C', defUid: 'O', atkRoll: null, defRoll: null },
    });
    await seed(room({ gameState: pre }));
    const next = { ...pre, rollSeed: null, duelState: { ...pre.duelState, defRoll: DIE } };
    await assertFails(updateDoc(ref(db('O')), { gameState: next }));
  });

  it('defender may commit a seed only after the attacker has rolled', async () => {
    const noAtk = gameState({
      phase: 'duel',
      duelState: { atkColor: 'blue', defColor: 'green', atkUid: 'C', defUid: 'O', atkRoll: null, defRoll: null },
    });
    await seed(room({ gameState: noAtk }));
    await assertFails(updateDoc(ref(db('O')), { 'gameState.rollSeed': serverTimestamp() }));

    const withAtk = gameState({
      phase: 'duel',
      duelState: { atkColor: 'blue', defColor: 'green', atkUid: 'C', defUid: 'O', atkRoll: 3, defRoll: null },
    });
    await seed(room({ gameState: withAtk }));
    await assertSucceeds(updateDoc(ref(db('O')), { 'gameState.rollSeed': serverTimestamp() }));
  });
});

describe('KOCKA (verifiable two dice)', () => {
  const kockaPending = () =>
    gameState({
      phase: 'special-trigger',
      rollSeed: seedTs(),
      specialTrigger: { type: 'dice', d1: null, d2: null, ring: 'outer', idx: 5, figId: 0, playerColor: 'blue' },
    });

  it('current player derives d1/d2 from the seed', async () => {
    await seed(room({ gameState: kockaPending() }));
    const next = kockaPending();
    next.rollSeed = null;
    next.specialTrigger = { ...next.specialTrigger, d1: DIE, d2: D2 };
    await assertSucceeds(updateDoc(ref(db('C')), { gameState: next }));
  });

  it('forged d1/d2 is rejected', async () => {
    await seed(room({ gameState: kockaPending() }));
    const next = kockaPending();
    next.rollSeed = null;
    next.specialTrigger = { ...next.specialTrigger, d1: 6, d2: 6 };
    await assertFails(updateDoc(ref(db('C')), { gameState: next }));
  });

  it('non-current player cannot derive KOCKA', async () => {
    await seed(room({ gameState: kockaPending() }));
    const next = kockaPending();
    next.rollSeed = null;
    next.specialTrigger = { ...next.specialTrigger, d1: DIE, d2: D2 };
    await assertFails(updateDoc(ref(db('O')), { gameState: next }));
  });
});

describe('initial-roll (verifiable value)', () => {
  const initPending = () =>
    gameState({
      phase: 'initial-roll',
      currentPlayerIndex: 0,
      rollSeed: seedTs(),
      initialRollOrder: ['red', 'blue', 'green'],
      initialRollIdx: 1, // roller = 'blue' (player C)
      initialRolls: {},
    });

  it('roller value must equal the seed derivation', async () => {
    await seed(room({ gameState: initPending() }));
    const next = initPending();
    next.rollSeed = null;
    next.initialRolls = { blue: DIE };
    next.initialRollIdx = 2;
    await assertSucceeds(updateDoc(ref(db('C')), { gameState: next }));
  });

  it('forged initial-roll value is rejected', async () => {
    await seed(room({ gameState: initPending() }));
    const next = initPending();
    next.rollSeed = null;
    next.initialRolls = { blue: 6 };
    next.initialRollIdx = 2;
    await assertFails(updateDoc(ref(db('C')), { gameState: next }));
  });

  it('cannot add an initial-roll value without a committed seed', async () => {
    const noSeed = gameState({
      phase: 'initial-roll', currentPlayerIndex: 0,
      initialRollOrder: ['red', 'blue', 'green'], initialRollIdx: 1, initialRolls: {},
    });
    await seed(room({ gameState: noSeed }));
    const next = { ...noSeed, initialRolls: { blue: 6 }, initialRollIdx: 2 };
    await assertFails(updateDoc(ref(db('C')), { gameState: next }));
  });

  it('any member may commit a seed during initial-roll', async () => {
    await seed(room({ gameState: gameState({ phase: 'initial-roll', currentPlayerIndex: 0 }) }));
    await assertSucceeds(updateDoc(ref(db('O')), { 'gameState.rollSeed': serverTimestamp() }));
  });
});

describe('stale-skip (recoverer only)', () => {
  const skipped = () =>
    gameState({
      currentPlayerIndex: 2,
      players: players().map((p, i) => (i === 1 ? { ...p, skipCount: 1 } : p)),
    });

  it('host may skip the absent current player', async () => {
    await seed(room());
    await assertSucceeds(updateDoc(ref(db('H')), { gameState: skipped() }));
  });

  it('an ordinary player may NOT skip', async () => {
    await seed(room());
    await assertFails(updateDoc(ref(db('O')), { gameState: skipped() }));
  });

  it('a present player MAY recover once the host heartbeat is stale', async () => {
    // host H last seen in 1970 → hostStale → any member may recover so the
    // room doesn't freeze on an absent host (who is usually also seat 0).
    await seed(room({ presence: { H: Timestamp.fromMillis(1000) } }));
    await assertSucceeds(updateDoc(ref(db('O')), { gameState: skipped() }));
  });

  it('an ordinary player may NOT recover while the host heartbeat is fresh', async () => {
    await seed(room({ presence: { H: Timestamp.fromMillis(Date.now()) } }));
    await assertFails(updateDoc(ref(db('O')), { gameState: skipped() }));
  });

  // HOST_AUTO_PLAY shape: the absent player's turn is rolled + a piece moved +
  // skipCount++ + turn advanced, all in one write, roster size preserved.
  const autoPlayed = () =>
    gameState({
      currentPlayerIndex: 2,
      diceValue: null, // consumed by the move, then turn advanced
      players: players().map((p, i) =>
        i === 1
          ? { ...p, skipCount: 1, figures: [{ id: 0, pos: { ring: 'outer', idx: 7 } }] } // a piece moved
          : p),
    });

  it('host may auto-play (roll + random move) an absent turn', async () => {
    await seed(room());
    await assertSucceeds(updateDoc(ref(db('H')), { gameState: autoPlayed() }));
  });

  it('an ordinary player may NOT auto-play someone else', async () => {
    await seed(room());
    await assertFails(updateDoc(ref(db('O')), { gameState: autoPlayed() }));
  });

  it('a recovery move that finishes a piece (standings grows) is allowed', async () => {
    await seed(room());
    const next = autoPlayed();
    next.standings = ['blue'];
    await assertSucceeds(updateDoc(ref(db('H')), { gameState: next }));
  });
});

describe('initial-roll phase', () => {
  it('host may reset for a tie re-roll (CONTINUE_AFTER_TIE) without growing rolls', async () => {
    await seed(room({ gameState: gameState({ phase: 'initial-roll', currentPlayerIndex: 0, initialRolls: { red: 4, blue: 4 } }) }));
    await assertSucceeds(
      updateDoc(ref(db('H')), {
        gameState: gameState({ phase: 'initial-roll', currentPlayerIndex: 0, initialRolls: {}, initialRollIdx: 0 }),
      })
    );
  });

  it('a non-host may not do initial-roll bookkeeping (rolls go through the seed flow)', async () => {
    await seed(room({ gameState: gameState({ phase: 'initial-roll', currentPlayerIndex: 0, initialRolls: { red: 4, blue: 4 } }) }));
    await assertFails(
      updateDoc(ref(db('O')), {
        gameState: gameState({ phase: 'initial-roll', currentPlayerIndex: 0, initialRolls: {}, initialRollIdx: 0 }),
      })
    );
  });

  it('only the host may flip initial-roll → rolling', async () => {
    await seed(room({ gameState: gameState({ phase: 'initial-roll', currentPlayerIndex: 0 }) }));
    await assertFails(
      updateDoc(ref(db('O')), { gameState: gameState({ phase: 'rolling', currentPlayerIndex: 0 }) })
    );
    await assertSucceeds(
      updateDoc(ref(db('H')), { gameState: gameState({ phase: 'rolling', currentPlayerIndex: 0 }) })
    );
  });
});

describe('seeding the first gameState', () => {
  it('host may seed (null → initial-roll)', async () => {
    await seed(room({ gameState: null }));
    await assertSucceeds(
      updateDoc(ref(db('H')), { gameState: gameState({ phase: 'initial-roll', currentPlayerIndex: 0 }) })
    );
  });

  it('a non-host may NOT seed', async () => {
    await seed(room({ gameState: null }));
    await assertFails(
      updateDoc(ref(db('O')), { gameState: gameState({ phase: 'initial-roll', currentPlayerIndex: 0 }) })
    );
  });
});

describe('removal cascade', () => {
  it('host may shrink roster + gameState in one write', async () => {
    await seed(room());
    const remaining = players().filter((p) => p.uid !== 'O');
    await assertSucceeds(
      updateDoc(ref(db('H')), {
        players: remaining,
        playerUids: ['H', 'C'],
        gameState: gameState({ players: remaining, currentPlayerIndex: 1, allColors: ['red', 'blue', 'green'] }),
      })
    );
  });

  it('an ordinary player may NOT remove anyone', async () => {
    await seed(room());
    const remaining = players().filter((p) => p.uid !== 'C');
    await assertFails(
      updateDoc(ref(db('O')), {
        players: remaining,
        playerUids: ['H', 'O'],
        gameState: gameState({ players: remaining, currentPlayerIndex: 0 }),
      })
    );
  });
});

describe('structural invariants', () => {
  it('currentPlayerIndex out of bounds is rejected', async () => {
    await seed(room());
    await assertFails(
      updateDoc(ref(db('C')), { gameState: gameState({ currentPlayerIndex: 9 }) })
    );
  });

  it('standings may not shrink', async () => {
    await seed(room({ gameState: gameState({ standings: ['red'] }) }));
    await assertFails(
      updateDoc(ref(db('C')), { gameState: gameState({ standings: [] }) })
    );
  });
});

describe('verifiable dice', () => {
  it('current player may commit a server-time seed (init)', async () => {
    await seed(room());
    await assertSucceeds(
      updateDoc(ref(db('C')), { 'gameState.rollSeed': serverTimestamp() })
    );
  });

  it('a client-chosen (non-server) seed is rejected', async () => {
    await seed(room());
    await assertFails(
      updateDoc(ref(db('C')), { 'gameState.rollSeed': Timestamp.fromMillis(5) })
    );
  });

  it('a non-current player may not init a roll', async () => {
    await seed(room());
    await assertFails(
      updateDoc(ref(db('O')), { 'gameState.rollSeed': serverTimestamp() })
    );
  });

  it('cannot re-init while a seed is already in flight (no re-roll)', async () => {
    await seed(room({ gameState: gameState({ rollSeed: Timestamp.fromMillis(1000003) }) }));
    await assertFails(
      updateDoc(ref(db('C')), { 'gameState.rollSeed': serverTimestamp() })
    );
  });

  it('derive: diceValue must equal (seed.ms % 6) + 1', async () => {
    // 1000003 % 6 === 1  →  expected die value 2
    await seed(room({ gameState: gameState({ rollSeed: Timestamp.fromMillis(1000003) }) }));
    await assertSucceeds(
      updateDoc(ref(db('C')), { gameState: gameState({ diceValue: 2, phase: 'moving' }) })
    );
  });

  it('derive: a forged diceValue is rejected', async () => {
    await seed(room({ gameState: gameState({ rollSeed: Timestamp.fromMillis(1000003) }) }));
    await assertFails(
      updateDoc(ref(db('C')), { gameState: gameState({ diceValue: 6, phase: 'moving' }) })
    );
  });

  it('cannot set a diceValue without a committed seed (forging a roll)', async () => {
    await seed(room()); // no rollSeed in flight
    await assertFails(
      updateDoc(ref(db('C')), { gameState: gameState({ diceValue: 6, phase: 'moving' }) })
    );
  });
});

describe('backward compatibility', () => {
  it('self-edit of name is allowed', async () => {
    await seed(room());
    const renamed = players().map((p) => (p.uid === 'O' ? { ...p, name: 'Owen' } : p));
    await assertSucceeds(updateDoc(ref(db('O')), { players: renamed }));
  });

  it('presence heartbeat is allowed', async () => {
    await seed(room());
    await assertSucceeds(updateDoc(ref(db('O')), { 'presence.O': 1234 }));
  });

  it('joining a waiting room is allowed', async () => {
    await seed(
      room({
        status: 'waiting',
        gameState: null,
        players: [players()[0]],
        playerUids: ['H'],
      })
    );
    await assertSucceeds(
      updateDoc(ref(db('N')), {
        players: [players()[0], { uid: 'N', color: 'blue', name: 'N', index: 1 }],
        playerUids: ['H', 'N'],
      })
    );
  });
});
