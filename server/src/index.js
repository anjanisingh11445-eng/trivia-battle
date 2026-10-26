import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import pg from 'pg';
import { CHALLENGE_SECONDS, COLLABORATIVE_POINTS, MAX_PLAYERS, MIN_PLAYERS, assignTeams, buildChallengeDeck, hashToken, makeRoomCode, normalizeAnswer, publicChallenge, teamAverage, triviaPoints } from './game.js';

const PORT = Number(process.env.PORT || 3001);
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim());
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: '20kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'trivia-battle-server', time: new Date().toISOString() }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] }, transports: ['websocket', 'polling'] });
const rooms = new Map();
const timers = new Map();
const pgPool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined }) : null;

if (process.env.NODE_ENV === 'production' && !pgPool) {
  console.error('DATABASE_URL is required in production for durable room/session recovery.');
  process.exit(1);
}

async function initDatabase() {
  if (!pgPool) return;
  await pgPool.query(`CREATE TABLE IF NOT EXISTS game_rooms (
    code varchar(6) PRIMARY KEY,
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await pgPool.query('SELECT state FROM game_rooms');
  for (const row of rows) {
    const room = row.state;
    if (room && room.code && room.players && room.status !== 'closed') {
      room.players = room.players.map(p => ({ ...p, connected: false, socketId: null }));
      rooms.set(room.code, room);
    }
  }
  console.log(`Restored ${rooms.size} room(s) from PostgreSQL.`);
}

function randomId() { return crypto.randomUUID(); }
function makeSessionToken() { return crypto.randomBytes(32).toString('base64url'); }
function sanitizeNickname(value) {
  return String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 18);
}
function cancelTimer(code) {
  const old = timers.get(code);
  if (old) clearTimeout(old);
  timers.delete(code);
}
async function persist(room) {
  if (!pgPool) return;
  const serializable = { ...room, players: room.players.map(({ socketId, ...p }) => ({ ...p, connected: false })) };
  await pgPool.query('INSERT INTO game_rooms(code, state, updated_at) VALUES($1, $2::jsonb, now()) ON CONFLICT(code) DO UPDATE SET state = EXCLUDED.state, updated_at = now()', [room.code, JSON.stringify(serializable)]);
}
function safeRoom(room, playerId) {
  const current = room.status === 'playing' || room.status === 'tiebreak' ? room.deck[room.challengeIndex] : null;
  const active = room.status === 'playing' || room.status === 'tiebreak';
  const teamScores = room.teams.map(team => ({ id: team.id, name: team.name, score: Math.round(team.score * 100) / 100, playerCount: room.players.filter(p => p.teamId === team.id).length }));
  return {
    code: room.code,
    hostPlayerId: room.hostPlayerId,
    status: room.status,
    players: room.players.map(p => ({ id: p.id, nickname: p.nickname, teamId: p.teamId, connected: Boolean(p.connected), personalScore: p.personalScore || 0, isHost: p.id === room.hostPlayerId })),
    teams: teamScores,
    round: active && room.status === 'playing' ? Math.floor(room.challengeIndex / 5) + 1 : room.completedRounds || 0,
    challengeNumber: active ? (room.status === 'tiebreak' ? room.tiebreakCount : room.challengeIndex + 1) : 0,
    challengeTotal: room.status === 'tiebreak' ? null : 25,
    deadline: room.deadline || null,
    challenge: publicChallenge(current),
    answeredByMe: Boolean(room.playerAnswers?.[playerId]),
    teamAnsweredByMe: Boolean(room.teamAnswers?.[room.players.find(p => p.id === playerId)?.teamId]),
    reveal: room.reveal || null,
    winnerTeamId: room.winnerTeamId || null,
    finalScores: room.finalScores || null,
    tieBreak: room.status === 'tiebreak',
    scoring: { correctTriviaBase: 50, maxSpeedBonus: 50, collaborativeCorrect: COLLABORATIVE_POINTS }
  };
}
function emitRoom(room) {
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit('room:update', { room: safeRoom(room, player.id), myPlayerId: player.id });
  }
}
async function changed(room) {
  try { await persist(room); } catch (error) { console.error('Could not persist room state:', error.message); }
  emitRoom(room);
}
function getPlayer(socket) {
  const code = socket.data.roomCode;
  const room = code && rooms.get(code);
  const player = room?.players.find(p => p.id === socket.data.playerId);
  return { room, player };
}
function startTimer(room, ms, callback) {
  cancelTimer(room.code);
  room.deadline = Date.now() + ms;
  timers.set(room.code, setTimeout(() => { timers.delete(room.code); callback().catch(err => console.error('Timer callback failed:', err)); }, ms));
}
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}
function resetChallengeAnswers(room) {
  room.playerAnswers = {};
  room.teamAnswers = {};
  room.reveal = null;
  room.deadline = null;
}
async function revealChallenge(room, timedOut = false) {
  if (!rooms.has(room.code)) return;
  cancelTimer(room.code);
  const challenge = room.deck[room.challengeIndex];
  if (!challenge) return finishScheduledMatch(room);
  if (challenge.type === 'trivia') {
    const pointsByTeam = { blue: [], purple: [] };
    for (const player of room.players) {
      const result = room.playerAnswers[player.id];
      const points = result?.points || 0;
      player.personalScore = (player.personalScore || 0) + points;
      pointsByTeam[player.teamId].push(points);
    }
    for (const team of room.teams) {
      const roster = room.players.filter(p => p.teamId === team.id).length;
      team.score += teamAverage(pointsByTeam[team.id], roster);
    }
  } else {
    for (const team of room.teams) {
      const answer = room.teamAnswers[team.id];
      if (answer?.correct) team.score += COLLABORATIVE_POINTS;
    }
  }
  room.reveal = {
    answer: challenge.answer,
    explanation: challenge.explanation,
    timedOut,
    playerResults: Object.fromEntries(Object.entries(room.playerAnswers).map(([id, result]) => [id, { correct: result.correct, points: result.points }])),
    teamResults: Object.fromEntries(Object.entries(room.teamAnswers).map(([id, result]) => [id, { correct: result.correct, points: result.correct ? COLLABORATIVE_POINTS : 0 }]))
  };
  room.deadline = Date.now() + 3500;
  await changed(room);
  startTimer(room, 3500, async () => {
    if (room.challengeIndex >= room.deck.length - 1) await finishScheduledMatch(room);
    else { room.challengeIndex += 1; resetChallengeAnswers(room); await showCurrentChallenge(room); }
  });
}
async function showCurrentChallenge(room) {
  const challenge = room.deck[room.challengeIndex];
  if (!challenge) return finishScheduledMatch(room);
  resetChallengeAnswers(room);
  room.status = 'playing';
  await changed(room);
  startTimer(room, CHALLENGE_SECONDS * 1000, async () => revealChallenge(room, true));
  await changed(room);
}
async function finishScheduledMatch(room) {
  cancelTimer(room.code);
  room.deadline = null;
  const high = Math.max(...room.teams.map(t => t.score));
  const tied = room.teams.filter(t => Math.abs(t.score - high) < 0.000001);
  if (tied.length > 1) {
    room.status = 'tiebreak';
    room.tiebreakCount = 1;
    room.tiebreakScores = {};
    room.deck = [{ ...buildChallengeDeck().find(c => c.type === 'trivia'), id: 'sudden-death-1', round: 6 }];
    room.challengeIndex = 0;
    resetChallengeAnswers(room);
    await showTiebreakChallenge(room);
    return;
  }
  room.status = 'finished';
  room.winnerTeamId = tied[0]?.id || null;
  room.finalScores = room.teams.map(t => ({ id: t.id, name: t.name, score: Math.round(t.score * 100) / 100 })).sort((a, b) => b.score - a.score);
  room.completedRounds = 5;
  await changed(room);
}
async function showTiebreakChallenge(room) {
  const triviaDeck = buildChallengeDeck().filter(c => c.type === 'trivia');
  const source = triviaDeck[(room.tiebreakCount - 1) % triviaDeck.length];
  room.deck = [{ ...source, id: `sudden-death-${room.tiebreakCount}`, round: 6 }];
  room.challengeIndex = 0;
  room.status = 'tiebreak';
  resetChallengeAnswers(room);
  await changed(room);
  startTimer(room, CHALLENGE_SECONDS * 1000, async () => finishTiebreakChallenge(room, true));
  await changed(room);
}
async function finishTiebreakChallenge(room, timedOut = false) {
  cancelTimer(room.code);
  const challenge = room.deck[0];
  const scores = room.teams.map(team => {
    const roster = room.players.filter(p => p.teamId === team.id);
    return { id: team.id, score: teamAverage(roster.map(p => room.playerAnswers[p.id]?.points || 0), roster.length) };
  });
  const high = Math.max(...scores.map(s => s.score));
  const winners = scores.filter(s => Math.abs(s.score - high) < 0.000001);
  room.reveal = { answer: challenge.answer, explanation: challenge.explanation, timedOut, playerResults: Object.fromEntries(Object.entries(room.playerAnswers).map(([id, r]) => [id, { correct: r.correct, points: r.points }])), tiebreakScores: scores };
  if (winners.length === 1) {
    room.status = 'finished'; room.winnerTeamId = winners[0].id;
    room.finalScores = room.teams.map(t => ({ id: t.id, name: t.name, score: Math.round(t.score * 100) / 100, tiebreakScore: winners[0].id === t.id ? high : scores.find(s => s.id === t.id)?.score || 0 })).sort((a, b) => b.score - a.score);
    room.deadline = null;
    await changed(room);
  } else {
    room.tiebreakCount += 1;
    room.deadline = Date.now() + 3500;
    await changed(room);
    startTimer(room, 3500, async () => showTiebreakChallenge(room));
  }
}
function newRoom(host, token) {
  return {
    code: makeRoomCode(), hostPlayerId: host.id,
    status: 'lobby', players: [{ ...host, tokenHash: hashToken(token), connected: true, socketId: null, teamId: null, personalScore: 0 }],
    teams: [{ id: 'blue', name: 'Neon Comets', score: 0 }, { id: 'purple', name: 'Cyber Phoenixes', score: 0 }],
    deck: buildChallengeDeck(), challengeIndex: 0, playerAnswers: {}, teamAnswers: {}, createdAt: Date.now(), completedRounds: 0
  };
}

io.on('connection', socket => {
  socket.data.lastAction = 0;
  socket.on('room:create', async (payload = {}, ack = () => {}) => {
    const now = Date.now(); if (now - socket.data.lastAction < 200) return ack({ error: 'Please wait a moment and try again.' }); socket.data.lastAction = now;
    const nickname = sanitizeNickname(payload.nickname);
    if (nickname.length < 2) return ack({ error: 'Choose a nickname with at least 2 characters.' });
    let code; do { code = makeRoomCode(); } while (rooms.has(code));
    const token = makeSessionToken();
    const host = { id: randomId(), nickname, personalScore: 0, teamId: null };
    const room = newRoom(host, token); room.code = code; room.players[0].socketId = socket.id;
    rooms.set(code, room); socket.data.roomCode = code; socket.data.playerId = host.id;
    await changed(room); ack({ ok: true, code, sessionToken: token, playerId: host.id });
  });
  socket.on('room:join', async (payload = {}, ack = () => {}) => {
    const now = Date.now(); if (now - socket.data.lastAction < 200) return ack({ error: 'Please wait a moment and try again.' }); socket.data.lastAction = now;
    const code = String(payload.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(code);
    if (!room) return ack({ error: 'Room not found. Check the code and try again.' });
    const token = String(payload.sessionToken || '');
    const existing = token ? room.players.find(p => p.tokenHash === hashToken(token)) : null;
    if (existing) {
      if (existing.socketId && existing.socketId !== socket.id) io.to(existing.socketId).emit('session:replaced');
      existing.connected = true; existing.socketId = socket.id;
      socket.data.roomCode = code; socket.data.playerId = existing.id;
      await changed(room); return ack({ ok: true, code, sessionToken: token, playerId: existing.id, reconnected: true });
    }
    if (room.status !== 'lobby') return ack({ error: 'This match has already started. Rejoin with your original session on this device.' });
    if (room.players.length >= MAX_PLAYERS) return ack({ error: 'This room is full (12 players maximum).' });
    const nickname = sanitizeNickname(payload.nickname);
    if (nickname.length < 2) return ack({ error: 'Choose a nickname with at least 2 characters.' });
    if (room.players.some(p => p.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase())) return ack({ error: 'That nickname is already in use in this room.' });
    const newToken = makeSessionToken();
    const player = { id: randomId(), nickname, tokenHash: hashToken(newToken), connected: true, socketId: socket.id, teamId: null, personalScore: 0 };
    room.players.push(player); socket.data.roomCode = code; socket.data.playerId = player.id;
    await changed(room); ack({ ok: true, code, sessionToken: newToken, playerId: player.id, reconnected: false });
  });
  socket.on('room:leave', async (_payload = {}, ack = () => {}) => {
    const { room, player } = getPlayer(socket);
    if (room && player && player.socketId === socket.id) {
      player.connected = false;
      player.socketId = null;
      socket.data.roomCode = null;
      socket.data.playerId = null;
      await changed(room);
    }
    if (typeof ack === 'function') ack({ ok: true });
  });
  socket.on('match:start', async (_payload = {}, ack = () => {}) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player) return ack({ error: 'Join a room first.' });
    if (player.id !== room.hostPlayerId) return ack({ error: 'Only the host can start the match.' });
    if (room.status !== 'lobby') return ack({ error: 'The match has already started.' });
    if (room.players.length < MIN_PLAYERS) return ack({ error: 'At least 2 players are required.' });
    room.teams = assignTeams(room.players); room.players.forEach(p => { p.personalScore = 0; }); room.deck = buildChallengeDeck(); room.challengeIndex = 0; room.status = 'playing'; room.completedRounds = 0;
    await showCurrentChallenge(room); ack({ ok: true });
  });
  socket.on('answer:submit', async (payload = {}, ack = () => {}) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player) return ack({ error: 'Join a room first.' });
    if (!['playing', 'tiebreak'].includes(room.status) || !room.deadline || Date.now() >= room.deadline) return ack({ error: 'This challenge has closed.' });
    const challenge = room.deck[room.challengeIndex];
    if (!challenge) return ack({ error: 'No active challenge.' });
    const raw = String(payload.answer ?? '').trim().slice(0, 160);
    if (!raw) return ack({ error: 'Enter an answer first.' });
    const correct = normalizeAnswer(raw) === normalizeAnswer(challenge.answer);
    if (challenge.type === 'trivia' || room.status === 'tiebreak') {
      if (room.playerAnswers[player.id]) return ack({ error: 'Your answer is already locked.' });
      const remainingSeconds = Math.max(0, (room.deadline - Date.now()) / 1000);
      room.playerAnswers[player.id] = { answer: raw, correct, points: triviaPoints(correct, remainingSeconds), submittedAt: Date.now() };
      await changed(room); ack({ ok: true, locked: true });
      const activeRoster = room.players.filter(p => p.connected);
      if (activeRoster.length && activeRoster.every(p => room.playerAnswers[p.id])) {
        if (room.status === 'tiebreak') await finishTiebreakChallenge(room, false); else await revealChallenge(room, false);
      }
      return;
    }
    if (!player.teamId) return ack({ error: 'Your team has not been assigned.' });
    if (room.teamAnswers[player.teamId]) return ack({ error: 'Your team has already locked an answer.' });
    room.teamAnswers[player.teamId] = { answer: raw, correct, submittedBy: player.id, submittedAt: Date.now() };
    await changed(room); ack({ ok: true, locked: true });
    if (room.teams.every(team => room.teamAnswers[team.id])) await revealChallenge(room, false);
  });
  socket.on('match:restart', async (_payload = {}, ack = () => {}) => {
    const { room, player } = getPlayer(socket);
    if (!room || !player) return ack({ error: 'Join a room first.' });
    if (player.id !== room.hostPlayerId) return ack({ error: 'Only the host can restart the match.' });
    if (room.status !== 'finished') return ack({ error: 'Finish the current match before restarting.' });
    cancelTimer(room.code);
    room.players.forEach(p => { p.personalScore = 0; p.teamId = null; });
    room.teams = [{ id: 'blue', name: 'Neon Comets', score: 0 }, { id: 'purple', name: 'Cyber Phoenixes', score: 0 }];
    room.deck = buildChallengeDeck(); room.challengeIndex = 0; room.status = 'lobby'; room.winnerTeamId = null; room.finalScores = null; room.tiebreakCount = 0; room.completedRounds = 0; resetChallengeAnswers(room);
    await changed(room); ack({ ok: true });
  });
  socket.on('disconnect', async () => {
    const { room, player } = getPlayer(socket);
    if (room && player && player.socketId === socket.id) { player.connected = false; player.socketId = null; await changed(room); }
  });
});

await initDatabase();
for (const room of rooms.values()) {
  if (['playing', 'tiebreak'].includes(room.status) && room.deadline) {
    const remaining = room.deadline - Date.now();
    if (remaining <= 0) {
      if (room.status === 'tiebreak') await finishTiebreakChallenge(room, true); else await revealChallenge(room, true);
    } else {
      startTimer(room, remaining, async () => room.status === 'tiebreak' ? finishTiebreakChallenge(room, true) : revealChallenge(room, true));
    }
  }
}
server.listen(PORT, () => console.log(`Trivia Battle server listening on port ${PORT}`));
