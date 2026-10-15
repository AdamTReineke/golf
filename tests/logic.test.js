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

// ---- scoring (step 2) ------------------------------------------------------

const LATER = '2026-10-14T20:05:00.000Z';

// A started game for the named players (roster order = names order), with
// firstOrder set to that same order. scoresByName fills course ci from hole 1.
function setup(names, scoresByName = {}, ci = 0) {
  const state = plain(Golf.newGame(withPlayers(names), seeded(1), NOW));
  const game = state.games.find((g) => g.id === state.currentGameId);
  game.firstOrder = game.playerIds.slice();
  const id = (name) => game.playerIds[names.indexOf(name)];
  for (const [name, values] of Object.entries(scoresByName)) {
    values.forEach((v, h) => { game.courses[ci].scores[id(name)][h] = v; });
  }
  return { state, id, gameId: state.currentGameId };
}

const names = (state, ids) => ids.map((pid) => Golf.getPlayer(state, pid).name);
const fill = (value, holes = 9) => new Array(holes).fill(value);
const gameOf = (state) => Golf.getGame(state, state.currentGameId);

test('turnOrder: hole 1 of the first course is the random first order', () => {
  const state = Golf.newGame(withPlayers(['Sam', 'Adam', 'Jo']), seeded(7), NOW);
  const game = plain(Golf.getActiveGame(state));
  assert.deepStrictEqual(plain(Golf.turnOrder(game, 0, 1)), game.firstOrder);
});

test('turnOrder: hole N+1 sorts by hole N, and ties keep hole N order', () => {
  const { state, id } = setup(['Sam', 'Adam', 'Jo'], { Sam: [3, 4], Adam: [2, 4], Jo: [3, 1] });
  const game = gameOf(state);
  assert.deepStrictEqual(names(state, Golf.turnOrder(game, 0, 2)), ['Adam', 'Sam', 'Jo']);
  // Hole 2 order is Adam, Sam, Jo. Adam and Sam tie on hole 2, so Adam stays ahead of Sam.
  assert.deepStrictEqual(names(state, Golf.turnOrder(game, 0, 3)), ['Jo', 'Adam', 'Sam']);
  assert.strictEqual(id('Jo'), Golf.turnOrder(game, 0, 3)[0]);
});

test('turnOrder: S ranks worst, and several skips keep their relative order', () => {
  const one = setup(['Sam', 'Adam', 'Jo'], { Sam: ['S'], Adam: [4], Jo: [3] });
  assert.deepStrictEqual(names(one.state, Golf.turnOrder(gameOf(one.state), 0, 2)), ['Jo', 'Adam', 'Sam']);
  const two = setup(['Sam', 'Adam', 'Jo'], { Sam: ['S'], Adam: ['S'], Jo: [5] });
  assert.deepStrictEqual(names(two.state, Golf.turnOrder(gameOf(two.state), 0, 2)), ['Jo', 'Sam', 'Adam']);
});

test('turnOrder: hole 1 of a later course follows the previous standings, incomplete cards last', () => {
  // Sam 27, Adam 36, and Jo has the lowest total (16) but a skip, so Jo ranks last.
  const { state } = setup(['Sam', 'Adam', 'Jo'], { Sam: fill(3), Adam: fill(4), Jo: [...fill(2, 8), 'S'] });
  const game = gameOf(state);
  assert.deepStrictEqual(names(state, Golf.standings(game, 0)), ['Sam', 'Adam', 'Jo']);
  assert.deepStrictEqual(names(state, Golf.turnOrder(game, 1, 1)), ['Sam', 'Adam', 'Jo']);
});

test('standings: ties keep the previous course last-hole order, not the first-hole order', () => {
  // Both end on 28. On hole 9 Adam (3) beats Sam (4) in the hole 8 order, so Adam is ahead.
  const { state } = setup(['Sam', 'Adam'], {
    Sam: [3, 3, 3, 3, 3, 3, 3, 4, 3],
    Adam: [3, 3, 3, 3, 3, 3, 3, 3, 4],
  });
  const game = gameOf(state);
  assert.deepStrictEqual(names(state, Golf.turnOrder(game, 0, 9)), ['Adam', 'Sam']);
  assert.deepStrictEqual(names(state, Golf.standings(game, 0)), ['Adam', 'Sam']);
});

test('courseTotal: skips add nothing and mark the card incomplete; vsPar covers entered holes', () => {
  const { state, id } = setup(['Sam', 'Adam'], { Sam: [3, 'S', 4] });
  const game = gameOf(state);
  assert.deepStrictEqual(plain(Golf.courseTotal(game, 0, id('Sam'))), {
    total: 7, skips: 1, complete: false, vsPar: 1,
  });
  const full = setup(['Sam'], { Sam: fill(2, 8) }, 1);
  const aces = gameOf(full.state);
  assert.deepStrictEqual(plain(Golf.courseTotal(aces, 1, full.id('Sam'))), {
    total: 16, skips: 0, complete: true, vsPar: null,
  });
  const done = setup(['Sam'], { Sam: fill(3) });
  assert.deepStrictEqual(plain(Golf.courseTotal(gameOf(done.state), 0, done.id('Sam'))), {
    total: 27, skips: 0, complete: true, vsPar: 0,
  });
});

test('cursor is the first empty cell in turn order, and moves on as scores are entered', () => {
  let { state, id, gameId } = setup(['Sam', 'Adam', 'Jo']);
  assert.deepStrictEqual(plain(Golf.cursor(gameOf(state))), { courseIndex: 0, hole: 1, playerId: id('Sam') });
  state = Golf.recordScore(state, gameId, 4, NOW);
  assert.deepStrictEqual(plain(Golf.cursor(gameOf(state))), { courseIndex: 0, hole: 1, playerId: id('Adam') });
  state = Golf.recordScore(state, gameId, 'S', NOW);
  state = Golf.recordScore(state, gameId, 3, NOW);
  // Hole 2 order from hole 1 (Sam 4, Adam S, Jo 3): Jo, Sam, Adam.
  assert.deepStrictEqual(plain(Golf.cursor(gameOf(state))), { courseIndex: 0, hole: 2, playerId: id('Jo') });
});

test('cursor is null only after every regulation cell is filled', () => {
  const partial = setup(['Sam'], { Sam: fill(2, 8) }, 0);
  assert.deepStrictEqual(plain(Golf.cursor(gameOf(partial.state))), { courseIndex: 0, hole: 9, playerId: partial.id('Sam') });

  const { state } = setup(['Sam'], { Sam: fill(2, 9) }, 0);
  const full = plain(state);
  const game = full.games.find((g) => g.id === full.currentGameId);
  game.courses[1].scores[game.playerIds[0]].fill(2);
  assert.notStrictEqual(Golf.cursor(game), null, 'Duffleboard is still open');
  game.courses[2].scores[game.playerIds[0]].fill(2);
  assert.strictEqual(Golf.cursor(game), null);
});

test('upNext names the player after the cursor in play order', () => {
  const { state, id } = setup(['Sam', 'Adam', 'Jo']);
  const game = gameOf(state);
  assert.strictEqual(Golf.upNext(game, Golf.cursor(game)), id('Adam'));
  assert.strictEqual(Golf.upNext(game, null), null);
});

test('recordScore validates the value and the game, and does not mutate its input', () => {
  const { state, gameId } = setup(['Sam', 'Adam']);
  const before = JSON.stringify(state);
  assert.throws(() => Golf.recordScore(state, gameId, 9, NOW), { message: /must be one of/ });
  assert.throws(() => Golf.recordScore(state, gameId, 0, NOW), { message: /must be one of/ });
  assert.throws(() => Golf.recordScore(state, gameId, 'x', NOW), { message: /must be one of/ });
  assert.throws(() => Golf.recordScore(state, 'g_missing', 3, NOW), { message: /No active game/ });
  const next = Golf.recordScore(state, gameId, 3, NOW);
  assert.strictEqual(JSON.stringify(state), before);
  assert.strictEqual(gameOf(next).courses[0].scores[plain(gameOf(state)).playerIds[0]][0], 3);
});

test('recordScore records S as a skip, which is not a number', () => {
  const { state, id, gameId } = setup(['Sam']);
  const next = Golf.recordScore(state, gameId, 'S', NOW);
  assert.strictEqual(gameOf(next).courses[0].scores[id('Sam')][0], 'S');
});

test('a full 2-player game reaches finished after exactly 52 recordScore calls', () => {
  let state = Golf.newGame(withPlayers(['Sam', 'Adam']), seeded(3), NOW);
  const gameId = state.currentGameId;
  for (let n = 1; n <= 52; n += 1) {
    state = Golf.recordScore(state, gameId, 1 + (n % 8), LATER);
    const expected = n === 52 ? 'finished' : 'active';
    assert.strictEqual(gameOf(state).status, expected, `after ${n} scores`);
  }
  const game = gameOf(state);
  assert.strictEqual(game.finishedAt, LATER);
  assert.strictEqual(Golf.cursor(game), null);
  assert.throws(() => Golf.recordScore(state, gameId, 3, LATER), { message: /No active game/ });
});

test('recordScore moves on to the next course after its last cell', () => {
  let { state, gameId } = setup(['Sam', 'Adam']);
  for (let n = 0; n < 18; n += 1) state = Golf.recordScore(state, gameId, 3, NOW);
  assert.strictEqual(Golf.cursor(gameOf(state)).courseIndex, 1);
  assert.strictEqual(gameOf(state).status, 'active');
});

test('priorHoleInfo: previous hole on this course, or the previous course total on hole 1 of courses 2+', () => {
  const { state, id } = setup(['Sam', 'Adam'], { Sam: [5] });
  const game = gameOf(state);
  assert.strictEqual(Golf.priorHoleInfo(game, { courseIndex: 0, hole: 1, playerId: id('Sam') }), null);
  assert.deepStrictEqual(plain(Golf.priorHoleInfo(game, { courseIndex: 0, hole: 2, playerId: id('Sam') })), {
    kind: 'hole', label: 'Hole 1', score: 5,
  });
  const full = setup(['Sam', 'Adam'], { Sam: fill(3), Adam: fill(4) });
  const after = gameOf(full.state);
  assert.deepStrictEqual(plain(Golf.priorHoleInfo(after, { courseIndex: 1, hole: 1, playerId: full.id('Sam') })), {
    kind: 'course', label: 'Mini Golf', total: 27, skips: 0, complete: true, vsPar: 0,
  });
  assert.strictEqual(Golf.priorHoleInfo(after, { courseIndex: 0, hole: 1, playerId: full.id('Sam') }), null);
});

test('courseResult: one complete lowest total wins; ties and skips are handled', () => {
  const won = setup(['Sam', 'Adam'], { Sam: fill(3), Adam: fill(4) });
  const r = plain(Golf.courseResult(gameOf(won.state), 0));
  assert.deepStrictEqual(r, {
    winnerId: won.id('Sam'), leaders: [won.id('Sam')], total: 27, runnerUpTotal: 36, tied: false,
  });

  const tied = setup(['Sam', 'Adam'], { Sam: fill(3), Adam: fill(3) });
  const t = plain(Golf.courseResult(gameOf(tied.state), 0));
  assert.strictEqual(t.winnerId, null);
  assert.strictEqual(t.tied, true);
  assert.deepStrictEqual(t.leaders.sort(), [tied.id('Sam'), tied.id('Adam')].sort());

  // Jo has the lowest total but a skip, so Jo cannot win.
  const skip = setup(['Sam', 'Adam', 'Jo'], { Sam: fill(3), Adam: fill(4), Jo: [...fill(1, 8), 'S'] });
  const s = plain(Golf.courseResult(gameOf(skip.state), 0));
  assert.strictEqual(s.winnerId, skip.id('Sam'));
  assert.strictEqual(s.runnerUpTotal, 36);

  const none = setup(['Sam'], { Sam: ['S'] });
  assert.deepStrictEqual(plain(Golf.courseResult(gameOf(none.state), 0)), {
    winnerId: null, leaders: [], total: null, runnerUpTotal: null, tied: false,
  });
});

// ---- undo, redo and cell edits (step 3) ------------------------------------

const LATEST = '2026-10-14T21:30:00.000Z';

// Records each value at the cursor, in order.
function record(state, gameId, values, now = NOW) {
  return values.reduce((s, v) => Golf.recordScore(s, gameId, v, now), state);
}

// A 2-player game played to the end (52 cells). The last score finishes it at LATER.
function finishedTwo() {
  let state = Golf.newGame(withPlayers(['Sam', 'Adam']), seeded(3), NOW);
  const gameId = state.currentGameId;
  state = record(state, gameId, Array.from({ length: 52 }, (_, n) => 1 + (n % 8)), LATER);
  return { state, gameId };
}

test('recordScore pushes a set action with prev null and clears redo', () => {
  let { state, id, gameId } = setup(['Sam', 'Adam']);
  state = record(state, gameId, [4, 5]);
  state = Golf.undo(state, gameId);
  assert.strictEqual(gameOf(state).redo.length, 1);
  state = Golf.recordScore(state, gameId, 2, NOW);
  const game = plain(gameOf(state));
  assert.deepStrictEqual(game.undo[game.undo.length - 1], {
    type: 'set', courseIndex: 0, hole: 1, playerId: id('Adam'), prev: null, next: 2,
  });
  assert.deepStrictEqual(game.redo, []);
  assert.throws(() => Golf.redo(state, gameId), { message: /Nothing to redo/ });
});

test('undo x k then redo x k returns a deep-equal state, mid-game', () => {
  let { state, gameId } = setup(['Sam', 'Adam', 'Jo']);
  state = record(state, gameId, [3, 'S', 4, 2, 5, 1, 6]);
  const before = plain(state);
  let s = state;
  for (let k = 0; k < 5; k += 1) s = Golf.undo(s, gameId);
  for (let k = 0; k < 5; k += 1) s = Golf.redo(s, gameId, NOW);
  assert.deepStrictEqual(plain(s), before);
  assert.strictEqual(Golf.canRedo(s, gameId), false);
});

test('undo x k then redo x k returns a deep-equal state, through the finish', () => {
  const { state: done, gameId } = finishedTwo();
  let s = done;
  for (let k = 0; k < 3; k += 1) s = Golf.undo(s, gameId);
  assert.strictEqual(gameOf(s).status, 'active');
  for (let k = 0; k < 3; k += 1) s = Golf.redo(s, gameId, LATER);
  assert.deepStrictEqual(plain(s), plain(done));
  assert.strictEqual(gameOf(s).finishedAt, LATER);
});

test('undo of the last score reopens a finished game, and redo finishes it again', () => {
  let { state, gameId } = setup(['Sam']);
  state = record(state, gameId, Array.from({ length: 26 }, () => 3), LATER);
  assert.strictEqual(gameOf(state).status, 'finished');
  let s = Golf.undo(state, gameId);
  assert.strictEqual(gameOf(s).status, 'active');
  assert.strictEqual(gameOf(s).finishedAt, null);
  s = Golf.redo(s, gameId, LATEST);
  assert.strictEqual(gameOf(s).status, 'finished');
  assert.strictEqual(gameOf(s).finishedAt, LATEST);
});

test('undo across a course boundary returns the cursor to the previous course\'s last cell', () => {
  let { state, gameId } = setup(['Sam', 'Adam']);
  state = record(state, gameId, Array.from({ length: 18 }, () => 3));
  assert.strictEqual(Golf.cursor(gameOf(state)).courseIndex, 1);
  state = Golf.undo(state, gameId);
  const game = gameOf(state);
  const last = Golf.turnOrder(game, 0, 9).slice(-1)[0];
  assert.deepStrictEqual(plain(Golf.cursor(game)), { courseIndex: 0, hole: 9, playerId: last });
  assert.strictEqual(game.courses[0].scores[last][8], null);
  assert.strictEqual(game.status, 'active');
});

test('editScore overwrites a filled cell without moving the cursor, and undo restores the old value', () => {
  let { state, id, gameId } = setup(['Sam', 'Adam']);
  state = record(state, gameId, [3, 4]);
  const cursorBefore = plain(Golf.cursor(gameOf(state)));
  state = Golf.editScore(state, gameId, 0, 1, id('Sam'), 5);
  assert.strictEqual(gameOf(state).courses[0].scores[id('Sam')][0], 5);
  // Hole 2 order follows hole 1, so Adam (4) now leads the cursor cell. The cursor is still derived.
  assert.deepStrictEqual(plain(Golf.cursor(gameOf(state))), { courseIndex: 0, hole: 2, playerId: id('Adam') });
  assert.strictEqual(plain(Golf.cursor(gameOf(state))).hole, cursorBefore.hole);
  state = Golf.undo(state, gameId);
  assert.strictEqual(gameOf(state).courses[0].scores[id('Sam')][0], 3);
  state = Golf.redo(state, gameId);
  assert.strictEqual(gameOf(state).courses[0].scores[id('Sam')][0], 5);
});

test('editScore rejects empty cells, invalid values, cells off the card, and inactive games', () => {
  let { state, id, gameId } = setup(['Sam', 'Adam']);
  state = record(state, gameId, [3]);
  assert.throws(() => Golf.editScore(state, gameId, 0, 1, id('Adam'), 4), { message: /filled cell/ });
  assert.throws(() => Golf.editScore(state, gameId, 0, 1, id('Sam'), 9), { message: /must be one of/ });
  assert.throws(() => Golf.editScore(state, gameId, 0, 1, id('Sam'), '3'), { message: /must be one of/ });
  assert.throws(() => Golf.editScore(state, gameId, 0, 10, id('Sam'), 3), { message: /not on the card/ });
  assert.throws(() => Golf.editScore(state, 'g_missing', 0, 1, id('Sam'), 3), { message: /No active game/ });
  const { state: done, gameId: doneId } = finishedTwo();
  const sam = gameOf(done).playerIds[0];
  assert.throws(() => Golf.editScore(done, doneId, 0, 1, sam, 3), { message: /No active game/ });
});

test('editing hole 3 changes the turn order of hole 4 when hole 4 is not yet played', () => {
  let { state, id, gameId } = setup(['Sam', 'Adam', 'Jo'], { Sam: [3, 3, 3], Adam: [3, 3, 3], Jo: [3, 3, 3] });
  assert.deepStrictEqual(names(state, Golf.turnOrder(gameOf(state), 0, 4)), ['Sam', 'Adam', 'Jo']);
  state = Golf.editScore(state, gameId, 0, 3, id('Jo'), 2);
  assert.deepStrictEqual(plain(names(state, Golf.turnOrder(gameOf(state), 0, 4))), ['Jo', 'Sam', 'Adam']);
  assert.deepStrictEqual(plain(Golf.cursor(gameOf(state))), { courseIndex: 0, hole: 4, playerId: id('Jo') });
});

test('undo and redo are unavailable on a fresh game and on an abandoned game', () => {
  let { state, gameId } = setup(['Sam', 'Adam']);
  assert.strictEqual(Golf.canUndo(state, gameId), false);
  assert.strictEqual(Golf.canRedo(state, gameId), false);
  state = record(state, gameId, [3]);
  state = Golf.newGame(state, seeded(9), NOW);
  assert.strictEqual(Golf.getGame(state, gameId).status, 'abandoned');
  assert.strictEqual(Golf.canUndo(state, gameId), false);
  assert.throws(() => Golf.undo(state, gameId), { message: /Nothing to undo/ });
});

test('a JSON round trip (reload) keeps undo and redo working', () => {
  let { state, id, gameId } = setup(['Sam', 'Adam', 'Jo']);
  state = record(state, gameId, [3, 'S', 4, 2]);
  state = Golf.editScore(state, gameId, 0, 1, id('Sam'), 5);
  state = Golf.undo(state, gameId);
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.strictEqual(Golf.canUndo(reloaded, gameId), true);
  assert.strictEqual(Golf.canRedo(reloaded, gameId), true);
  assert.deepStrictEqual(plain(Golf.undo(reloaded, gameId)), plain(Golf.undo(state, gameId)));
  assert.deepStrictEqual(plain(Golf.redo(reloaded, gameId)), plain(Golf.redo(state, gameId)));
  const migrated = Golf.migrate(JSON.parse(JSON.stringify(state)));
  assert.deepStrictEqual(plain(Golf.undo(migrated, gameId)), plain(Golf.undo(state, gameId)));
});
