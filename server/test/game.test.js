import test from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES, CHALLENGE_SECONDS, MAX_PLAYERS, MIN_PLAYERS, buildChallengeDeck, hashToken, normalizeAnswer, teamAverage, triviaPoints } from '../src/game.js';

test('correct trivia answer scores 100 at the start and 50 base plus speed bonus', () => {
  assert.equal(triviaPoints(true, 20), 100);
  assert.equal(triviaPoints(true, 10), 75);
  assert.equal(triviaPoints(true, 1), 52);
  assert.equal(triviaPoints(true, 0), 50);
});

test('incorrect and unanswered trivia score zero', () => {
  assert.equal(triviaPoints(false, 20), 0);
  assert.equal(triviaPoints(false, 0), 0);
});

test('trivia timing is clamped to the challenge duration', () => {
  assert.equal(triviaPoints(true, 40), 100);
  assert.equal(triviaPoints(true, -5), 50);
  assert.equal(CHALLENGE_SECONDS, 20);
});

test('team average includes zero-valued missed answers when roster size is provided', () => {
  assert.equal(teamAverage([100, 0, 50], 3), 50);
  assert.equal(teamAverage([], 0), 0);
});

test('answer normalization ignores case, punctuation, and spacing', () => {
  assert.equal(normalizeAnswer('  New-York! '), normalizeAnswer('new york'));
  assert.equal(normalizeAnswer('H₂O'), normalizeAnswer('h₂o'));
});

test('session tokens are hashed deterministically and not stored in plaintext', () => {
  assert.equal(hashToken('secret-token'), hashToken('secret-token'));
  assert.notEqual(hashToken('secret-token'), 'secret-token');
  assert.notEqual(hashToken('secret-token'), hashToken('other-token'));
});

test('deck contains 25 challenges across all planned formats and five rounds', () => {
  const deck = buildChallengeDeck();
  assert.equal(deck.length, 25);
  assert.deepEqual(new Set(deck.map(c => c.type)), new Set(['trivia', 'word', 'strategy']));
  assert.deepEqual(new Set(deck.map(c => c.round)), new Set([1, 2, 3, 4, 5]));
  for (let round = 1; round <= 5; round++) {
    const types = new Set(deck.filter(c => c.round === round).map(c => c.type));
    assert.equal(types.size, 3, `round ${round} includes all challenge types`);
  }
  assert.equal(MAX_PLAYERS, 12);
  assert.equal(MIN_PLAYERS, 2);
});

test('curated answers exist for every challenge', () => {
  assert.equal(CHALLENGES.length, 25);
  assert.ok(CHALLENGES.every(c => c.prompt && c.answer && c.explanation));
});

test('automatic teams are balanced for every room size from 2 through 12', async () => {
  const { assignTeams } = await import('../src/game.js');
  for (let size = MIN_PLAYERS; size <= MAX_PLAYERS; size++) {
    const players = Array.from({ length: size }, (_, i) => ({ id: `p${i}`, teamId: null }));
    const teams = assignTeams(players);
    assert.equal(teams.length, 2);
    const blue = players.filter(p => p.teamId === 'blue').length;
    const purple = players.filter(p => p.teamId === 'purple').length;
    assert.equal(Math.abs(blue - purple) <= 1, true, `size ${size}`);
    assert.equal(blue + purple, size);
  }
});

test('collaborative correct-answer value is fixed at 100 points', async () => {
  const { COLLABORATIVE_POINTS } = await import('../src/game.js');
  assert.equal(COLLABORATIVE_POINTS, 100);
});
