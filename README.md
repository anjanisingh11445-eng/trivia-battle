# Trivia Battle Multiplayer

A real-time, two-team trivia game built with React, Vite, Node.js, Express, Socket.IO, and PostgreSQL. The project supports 2–12 players, guest nicknames, room codes, automatic team balancing, 25 mixed challenges, server-side timers and scoring, reconnectable sessions, host controls, sudden-death tie-breakers, and a neon arcade UI.

## 1. Scoring is documented first

Read [`SCORING.md`](./SCORING.md) before running or modifying the game. It defines the exact speed bonus, team averaging, collaborative points, and tie-breaker rules. The automated tests assert the core formula.

## 2. Requirements

- Node.js 20+ (Node 22 recommended)
- npm
- PostgreSQL 14+ for durable room and session recovery in production (optional for local development)

## 3. Run locally

From the project root:

```bash
npm install
npm --prefix server install
npm --prefix client install
cp server/.env.example server/.env
npm run dev
```

Open **http://localhost:5173**. In two browser windows or devices, choose different nicknames, create a room in one, and join with the six-character room code in the other. The host can start when at least two players have joined.

Local development works without PostgreSQL, but room state is then in memory and is lost if the server restarts. The server reads `server/.env` automatically. To test persistence locally, start the included database with `docker compose up -d postgres`, then set `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trivia_battle` in `server/.env`. For production, set `DATABASE_URL` to a managed PostgreSQL connection string. The server creates its `game_rooms` table on startup and persists room snapshots, hashed reconnect tokens, scores, and active deadlines.

## 4. Test and build

```bash
npm test
```

This runs Node's scoring/game-logic tests and builds the production frontend. For a manual multiplayer smoke test, use two browser profiles and verify room creation/joining, team assignment, all challenge types, answer locking, the timer, disconnect/reconnect, final results, tie-breaker behavior, and host rematch.

## 5. Deploy online

Deploy the frontend and backend separately so Socket.IO/WebSocket traffic reaches a long-running Node service. Suitable platforms include Render, Railway, or Fly.io for the server and Vercel, Netlify, or a static host for the frontend. Provider dashboards and pricing change; use the current platform instructions for your chosen account.

### A. Create PostgreSQL

1. Create a managed PostgreSQL database.
2. Copy its connection string. Keep it private.
3. If the provider requires TLS, set `PGSSL=true`; otherwise use the provider's documented connection settings.

### B. Deploy the backend

1. Create a Node web service from this repository.
2. Set the service root to `server` if the platform supports monorepo root directories. Otherwise use the repository root with the commands below.
3. Build/install command from the repository root: `npm install && npm --prefix server install`.
4. Start command from the repository root: `npm start` (or `npm --prefix server start` if the root package is not used).
5. Add environment variables:
   - `NODE_ENV=production`
   - `PORT` (usually supplied by the host)
   - `DATABASE_URL` (managed PostgreSQL connection string)
   - `CLIENT_ORIGIN=https://YOUR-FRONTEND-DOMAIN` (exact origin; comma-separated origins are supported)
   - `PGSSL=true` only if required by your database provider
6. Confirm `https://YOUR-BACKEND-DOMAIN/api/health` returns `{ "ok": true, ... }`.

### C. Deploy the frontend

1. Create a static-site project from the same repository.
2. Root directory: `client` (or run commands from the repository root).
3. Build command from the repository root: `npm install && npm --prefix client install && npm --prefix client run build`.
4. Publish directory: `client/dist`.
5. Add build-time environment variable `VITE_SERVER_URL=https://YOUR-BACKEND-DOMAIN` (no trailing slash). If your host only allows variables in the client root, set it there.
6. Deploy, then copy the final frontend origin into the backend's `CLIENT_ORIGIN` variable and redeploy the backend.

### D. Production verification

- Open the frontend URL in two separate browsers and play a complete match.
- Check that WebSocket connections succeed in the browser's network panel.
- Disconnect one browser and reconnect using the same browser storage; its player/team/score should be restored while the timer continues.
- Restart the backend and verify PostgreSQL restores the room snapshot and deadline.
- Verify a random client cannot start a match as host or submit a second answer.
- Use HTTPS for both frontend and backend. Never commit `.env` or expose `DATABASE_URL`.

## 6. Important operational notes

- Room snapshots are persisted in PostgreSQL when `DATABASE_URL` is configured. The current implementation uses a single Node process with in-process timers; deploy a single server instance unless you add distributed Socket.IO coordination and distributed timer ownership (for example, Redis plus a Socket.IO adapter). Multiple independent instances without that coordination can disagree about timers and room state.
- In-memory local mode is intentionally for development only. Production mode exits if `DATABASE_URL` is missing.
- Session tokens are generated with cryptographic randomness and stored as SHA-256 hashes on the server. The raw token is kept in the player's browser local storage so the same device can reconnect.
- Nicknames are guest identities, not verified accounts. Anyone who has access to a player's browser storage may use that local session.
- The included question bank is a curated starter set and can be expanded in `server/src/game.js`.
- A reconnect token can restore a player after a server restart while the room snapshot remains in the database. Since the active timer is persisted as an absolute deadline, it continues rather than resetting.

## Project layout

```text
trivia-battle/
  client/                 React + Vite UI
    src/main.jsx           Lobby, gameplay, scoreboard, results
    src/styles.css         Responsive neon arcade theme
  server/
    src/index.js           Express + Socket.IO game server
    src/game.js            Question bank and pure game/scoring logic
    test/game.test.js      Scoring and deck tests
  SCORING.md               Exact scoring rules
  .env.example             Local environment template
```
