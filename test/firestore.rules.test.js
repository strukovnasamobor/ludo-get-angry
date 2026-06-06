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

describe('duel defender', () => {
  const duel = () =>
    gameState({
      phase: 'duel',
      duelState: { atkColor: 'blue', defColor: 'green', atkUid: 'C', defUid: 'O', defRoll: null, atkRoll: null },
    });

  it('defender may write only their roll', async () => {
    await seed(room({ gameState: duel() }));
    const next = duel();
    next.duelState = { ...next.duelState, defRoll: 4 };
    await assertSucceeds(updateDoc(ref(db('O')), { gameState: next }));
  });

  it('defender may NOT tamper with the roster while rolling', async () => {
    await seed(room({ gameState: duel() }));
    const tampered = duel();
    tampered.duelState = { ...tampered.duelState, defRoll: 4 };
    tampered.players = players().map((p) => (p.uid === 'O' ? { ...p, color: 'red' } : p));
    await assertFails(updateDoc(ref(db('O')), { gameState: tampered }));
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
});

describe('initial-roll phase', () => {
  it('any member may roll while phase stays initial-roll', async () => {
    await seed(room({ gameState: gameState({ phase: 'initial-roll', currentPlayerIndex: 0 }) }));
    await assertSucceeds(
      updateDoc(ref(db('O')), {
        gameState: gameState({ phase: 'initial-roll', currentPlayerIndex: 0, initialRollIdx: 1 }),
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
