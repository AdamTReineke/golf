'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load the pure logic script from index.html and run it in its own vm context.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script id="logic">([\s\S]*?)<\/script>/);
assert.ok(match, 'index.html must contain <script id="logic">');
const Golf = vm.runInNewContext(`${match[1]}\n;Golf`, {});

// Values made inside the vm context have another realm's prototypes, so
// strip them with a JSON round trip before deep-comparing.
const plain = (value) => JSON.parse(JSON.stringify(value));

// Seeded PRNG (mulberry32). Returns floats in [0, 1).
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = '2026-10-14T19:14:00.000Z';

// Empty state with the given players added, all of them on today's roster.
function withPlayers(names, rand = seeded(1)) {
  let state = Golf.emptyState();
  for (const name of names) state = Golf.addPlayer(state, name, rand, NOW);
  return Golf.setRoster(state, state.players.map((p) => p.id));
}

test('VENUES matches spec section 2', () => {
  assert.strictEqual(Golf.VENUES.length, 1);
  const venue = plain(Golf.VENUES[0]);
  assert.strictEqual(venue.id, 'redmond');
  assert.strictEqual(venue.name, 'Redmond');
  assert.deepStrictEqual(venue.courses.map((c) => c.id), ['redmond-mini', 'redmond-aces', 'redmond-duff']);
  assert.deepStrictEqual(venue.courses.map((c) => c.name), ['Mini Golf', 'Aces', 'Duffleboard']);
  assert.deepStrictEqual(venue.courses.map((c) => c.holes), [9, 8, 9]);
  assert.deepStrictEqual(venue.courses[0].par, [3, 3, 3, 3, 3, 3, 3, 3, 3]);
  assert.strictEqual(venue.courses[1].par, null);
  assert.strictEqual(venue.courses[2].par, null);
  for (const course of venue.courses) {
    assert.strictEqual(course.lowerIsBetter, true);
    assert.deepStrictEqual(course.keys, [1, 2, 3, 4, 5, 6, 7, 8]);
  }
});

test('PALETTE has 8 distinct colors', () => {
  const colors = plain(Golf.PALETTE);
  assert.strictEqual(colors.length, 8);
  assert.strictEqual(new Set(colors).size, 8);
});

test('emptyState follows the schemaVersion 1 data model', () => {
  assert.deepStrictEqual(plain(Golf.emptyState()), {
    schemaVersion: 1,
    players: [],
    lastRoster: [],
    currentGameId: null,
    lastExportAt: null,
    games: [],
  });
});

test('makeId uses the injected random source and the prefix', () => {
  const a = Golf.makeId('p', seeded(5));
  const b = Golf.makeId('p', seeded(5));
  const c = Golf.makeId('p', seeded(6));
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.match(a, /^p_[0-9a-f]{32}$/);
});

test('shuffle is Fisher-Yates and does not mutate its input', () => {
  // With rand() always 0: [a,b,c] -> [c,b,a] -> [b,c,a]
  assert.deepStrictEqual(plain(Golf.shuffle(['a', 'b', 'c'], () => 0)), ['b', 'c', 'a']);
  const input = ['a', 'b', 'c'];
  Golf.shuffle(input, seeded(3));
  assert.deepStrictEqual(input, ['a', 'b', 'c']);
});

test('addPlayer trims, stores a visible player, and assigns a palette color', () => {
  const state = Golf.addPlayer(Golf.emptyState(), '  Adam  ', seeded(1), NOW);
  const players = plain(state.players);
  assert.strictEqual(players.length, 1);
  assert.strictEqual(players[0].name, 'Adam');
  assert.strictEqual(players[0].hidden, false);
  assert.strictEqual(players[0].createdAt, NOW);
  assert.match(players[0].id, /^p_/);
  assert.ok(plain(Golf.PALETTE).includes(players[0].color));
});

test('addPlayer rejects empty and whitespace-only names', () => {
  assert.throws(() => Golf.addPlayer(Golf.emptyState(), '', seeded(1)), { message: /cannot be empty/ });
  assert.throws(() => Golf.addPlayer(Golf.emptyState(), '   ', seeded(1)), { message: /cannot be empty/ });
});

test('addPlayer rejects duplicate names case-insensitively', () => {
  const rand = seeded(1);
  const state = Golf.addPlayer(Golf.emptyState(), 'Sam', rand);
  assert.throws(() => Golf.addPlayer(state, 'sam', rand), { message: /already in the player list/ });
  assert.throws(() => Golf.addPlayer(state, ' SAM ', rand), { message: /already in the player list/ });
});

test('addPlayer does not mutate its input', () => {
  const state = Golf.emptyState();
  Golf.addPlayer(state, 'Adam', seeded(1));
  assert.strictEqual(state.players.length, 0);
});

test('each player gets a distinct color until the palette wraps', () => {
  const rand = seeded(2);
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const state = names.reduce((s, n) => Golf.addPlayer(s, n, rand), Golf.emptyState());
  const colors = plain(state.players).map((p) => p.color);
  assert.strictEqual(new Set(colors).size, 8);
});

test('renamePlayer keeps the id and color, and allows changing only the case of your own name', () => {
  const state = withPlayers(['Sam', 'Adam']);
  const sam = plain(state.players[0]);
  const renamed = Golf.renamePlayer(state, sam.id, 'SAM');
  const after = plain(Golf.getPlayer(renamed, sam.id));
  assert.strictEqual(after.name, 'SAM');
  assert.strictEqual(after.id, sam.id);
  assert.strictEqual(after.color, sam.color);
  assert.strictEqual(state.players[0].name, 'Sam', 'input is not mutated');
});

test('renamePlayer rejects a name used by another player and unknown ids', () => {
  const state = withPlayers(['Sam', 'Adam']);
  const sam = plain(state.players[0]);
  assert.throws(() => Golf.renamePlayer(state, sam.id, 'adam'), { message: /already in the player list/ });
  assert.throws(() => Golf.renamePlayer(state, sam.id, ''), { message: /cannot be empty/ });
  assert.throws(() => Golf.renamePlayer(state, 'p_missing', 'Jo'), { message: /not in the list/ });
});

test('hidePlayer is a soft delete: hidden, off today\'s roster, history kept', () => {
  let state = Golf.newGame(withPlayers(['Sam', 'Adam', 'Jo']), seeded(4), NOW);
  const gameCount = state.games.length;
  const sam = plain(state.players[0]);
  state = Golf.hidePlayer(state, sam.id);
  assert.strictEqual(Golf.getPlayer(state, sam.id).hidden, true);
  assert.deepStrictEqual(plain(Golf.visiblePlayers(state)).map((p) => p.name), ['Adam', 'Jo']);
  assert.ok(!state.lastRoster.includes(sam.id));
  assert.strictEqual(state.games.length, gameCount);
  assert.ok(state.games[0].playerIds.includes(sam.id), 'past games keep the player');
});

test('a hidden name can be added again as a new player, and hidden players cannot be renamed', () => {
  const rand = seeded(9);
  let state = withPlayers(['Sam']);
  const oldId = state.players[0].id;
  state = Golf.hidePlayer(state, oldId);
  state = Golf.addPlayer(state, 'Sam', rand);
  assert.strictEqual(Golf.visiblePlayers(state).length, 1);
  assert.notStrictEqual(Golf.visiblePlayers(state)[0].id, oldId);
  assert.throws(() => Golf.renamePlayer(state, oldId, 'Kim'), { message: /not in the list/ });
});

test('setRoster enforces 1 to 6 players', () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const state = withPlayers(names.slice(0, 6));
  const ids = plain(state.players).map((p) => p.id);
  assert.throws(() => Golf.setRoster(state, []), { message: /between 1 and 6/ });
  assert.strictEqual(plain(Golf.setRoster(state, [ids[0]])).lastRoster.length, 1);
  assert.strictEqual(plain(Golf.setRoster(state, ids)).lastRoster.length, 6);
  let seven = Golf.emptyState();
  for (const n of names) seven = Golf.addPlayer(seven, n, seeded(1), NOW);
  assert.throws(() => Golf.setRoster(seven, plain(seven.players).map((p) => p.id)), { message: /between 1 and 6/ });
});

test('setRoster rejects duplicates, unknown ids and hidden players', () => {
  const state = withPlayers(['Sam', 'Adam']);
  const [sam, adam] = plain(state.players).map((p) => p.id);
  assert.throws(() => Golf.setRoster(state, [sam, sam]), { message: /picked once/ });
  assert.throws(() => Golf.setRoster(state, [sam, 'p_nope']), { message: /not in the list/ });
  const hidden = Golf.hidePlayer(state, adam);
  assert.throws(() => Golf.setRoster(hidden, [sam, adam]), { message: /not in the list/ });
});

test('rosterPlayers returns today\'s roster in roster order', () => {
  const state = withPlayers(['Sam', 'Adam', 'Jo']);
  const [sam, adam, jo] = plain(state.players).map((p) => p.id);
  const ordered = Golf.setRoster(state, [jo, sam, adam]);
  assert.deepStrictEqual(plain(Golf.rosterPlayers(ordered)).map((p) => p.name), ['Jo', 'Sam', 'Adam']);
});

test('migrate of null gives an empty state', () => {
  assert.deepStrictEqual(plain(Golf.migrate(null)), plain(Golf.emptyState()));
});

test('migrate accepts a current-version state unchanged and fills missing fields', () => {
  const state = withPlayers(['Sam', 'Adam']);
  assert.deepStrictEqual(plain(Golf.migrate(plain(state))), plain(state));
  const partial = Golf.migrate({ schemaVersion: 1, players: [] });
  assert.deepStrictEqual(plain(partial.games), []);
  assert.deepStrictEqual(plain(partial.lastRoster), []);
  assert.strictEqual(partial.currentGameId, null);
});

test('migrate rejects a newer schemaVersion with NEWER_SCHEMA', () => {
  assert.throws(() => Golf.migrate({ schemaVersion: 2, players: [] }), {
    code: 'NEWER_SCHEMA',
    message: /newer version.*schemaVersion 2/,
  });
});

test('migrate rejects data without a valid schemaVersion or that is not an object', () => {
  assert.throws(() => Golf.migrate({ players: [] }), { message: /schemaVersion/ });
  assert.throws(() => Golf.migrate({ schemaVersion: '1', players: [] }), { message: /schemaVersion/ });
  assert.throws(() => Golf.migrate([]), { message: /not an object/ });
  assert.throws(() => Golf.migrate('golf'), { message: /not an object/ });
});

test('newGame builds an active game with the roster, empty courses and a first order', () => {
  const state = withPlayers(['Sam', 'Adam', 'Jo']);
  const next = Golf.newGame(state, seeded(7), NOW);
  const game = plain(Golf.getActiveGame(next));
  assert.ok(game, 'there is an active game');
  assert.strictEqual(next.currentGameId, game.id);
  assert.strictEqual(game.status, 'active');
  assert.strictEqual(game.venueId, 'redmond');
  assert.strictEqual(game.startedAt, NOW);
  assert.strictEqual(game.finishedAt, null);
  assert.deepStrictEqual(game.playerIds, plain(state.lastRoster));
  assert.deepStrictEqual([...game.firstOrder].sort(), [...game.playerIds].sort());
  assert.deepStrictEqual(game.courses.map((c) => c.courseId), ['redmond-mini', 'redmond-aces', 'redmond-duff']);
  const holes = [9, 8, 9];
  game.courses.forEach((course, i) => {
    assert.strictEqual(course.playoff, null);
    assert.deepStrictEqual(Object.keys(course.scores).sort(), [...game.playerIds].sort());
    for (const id of game.playerIds) {
      assert.deepStrictEqual(course.scores[id], new Array(holes[i]).fill(null));
    }
  });
  assert.deepStrictEqual(game.replayQueue, null);
  assert.deepStrictEqual(game.undo, []);
  assert.deepStrictEqual(game.redo, []);
});

test('newGame first order is deterministic for a seeded rand', () => {
  const state = withPlayers(['Sam', 'Adam', 'Jo', 'Kim']);
  const a = plain(Golf.getActiveGame(Golf.newGame(state, seeded(42), NOW)));
  const b = plain(Golf.getActiveGame(Golf.newGame(state, seeded(42), NOW)));
  assert.deepStrictEqual(a.firstOrder, b.firstOrder);
  assert.strictEqual(a.id, b.id);
});

test('newGame first order varies across seeds', () => {
  const state = withPlayers(['Sam', 'Adam', 'Jo']);
  const orders = new Set();
  for (let seed = 1; seed <= 50; seed += 1) {
    orders.add(JSON.stringify(plain(Golf.getActiveGame(Golf.newGame(state, seeded(seed), NOW))).firstOrder));
  }
  assert.ok(orders.size > 1);
});

test('newGame abandons the previous active game and leaves finished games alone', () => {
  let state = withPlayers(['Sam', 'Adam']);
  state = Golf.newGame(state, seeded(1), NOW);
  const firstId = state.currentGameId;
  state.games[0].status = 'finished';
  state = Golf.newGame(state, seeded(2), NOW);
  assert.strictEqual(state.games.length, 2);
  assert.strictEqual(state.games[0].id, firstId);
  assert.strictEqual(state.games[0].status, 'finished');
  state = Golf.newGame(state, seeded(3), NOW);
  assert.strictEqual(state.games[1].status, 'abandoned');
  assert.strictEqual(state.games[2].status, 'active');
  assert.strictEqual(state.currentGameId, state.games[2].id);
});

test('newGame does not mutate its input', () => {
  const state = withPlayers(['Sam', 'Adam']);
  const before = JSON.stringify(state);
  Golf.newGame(state, seeded(1), NOW);
  assert.strictEqual(JSON.stringify(state), before);
});

test('newGame fails without a valid roster', () => {
  assert.throws(() => Golf.newGame(Golf.emptyState(), seeded(1)), { message: /between 1 and 6/ });
});

test('rerollFirstOrder shuffles the roster and is blocked after the first score', () => {
  const state = Golf.newGame(withPlayers(['Sam', 'Adam', 'Jo']), seeded(3), NOW);
  const gameId = state.currentGameId;
  const rerolled = Golf.rerollFirstOrder(state, gameId, seeded(4));
  const game = plain(Golf.getGame(rerolled, gameId));
  assert.deepStrictEqual([...game.firstOrder].sort(), [...game.playerIds].sort());

  const touched = plain(state);
  touched.games[0].courses[0].scores[touched.games[0].playerIds[0]][0] = 3;
  assert.strictEqual(Golf.canRerollFirstOrder(touched.games[0]), false);
  assert.throws(() => Golf.rerollFirstOrder(touched, gameId, seeded(5)), { message: /before the first score/ });
});

test('firstOrderSentence reads like the spec banner', () => {
  const state = withPlayers(['Sam', 'Adam', 'Jo']);
  const game = plain(Golf.getActiveGame(Golf.newGame(state, seeded(1), NOW)));
  const [sam, adam, jo] = plain(state.players).map((p) => p.id);
  game.firstOrder = [sam, adam, jo];
  assert.strictEqual(Golf.firstOrderSentence(state, game), 'Sam goes first, then Adam, Jo');
  game.firstOrder = [jo];
  assert.strictEqual(Golf.firstOrderSentence(state, game), 'Jo goes first');
});

test('naiveCursor points at the first empty hole, and null when the game is full', () => {
  const state = Golf.newGame(withPlayers(['Sam']), seeded(1), NOW);
  const game = plain(Golf.getActiveGame(state));
  assert.deepStrictEqual(plain(Golf.naiveCursor(game)), { courseIndex: 0, courseId: 'redmond-mini', hole: 1 });
  const id = game.playerIds[0];
  game.courses.forEach((course) => {
    course.scores[id] = course.scores[id].map(() => 2);
  });
  assert.strictEqual(Golf.naiveCursor(game), null);
});
