import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const socket = io(SERVER_URL, { autoConnect: true, reconnection: true, reconnectionAttempts: Infinity, timeout: 10000 });
const SESSION_KEY = 'trivia-battle-session-v1';

function readSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
function saveSession(value) { localStorage.setItem(SESSION_KEY, JSON.stringify(value)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function emitAck(event, payload) { return new Promise(resolve => socket.emit(event, payload, response => resolve(response || { error: 'No response from server.' }))); }

function App() {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [session, setSession] = useState(readSession);
  const [room, setRoom] = useState(null);
  const [myPlayerId, setMyPlayerId] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [answer, setAnswer] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(20);
  const [copyState, setCopyState] = useState(false);
  const challengeKeyRef = useRef('');

  const me = room?.players.find(p => p.id === myPlayerId);
  const myTeam = room?.teams.find(t => t.id === me?.teamId);
  const currentChallenge = room?.challenge;
  const isReveal = Boolean(room?.reveal);
  const isCollaborative = currentChallenge && currentChallenge.type !== 'trivia' && !room?.tieBreak;
  const isHost = room?.hostPlayerId === myPlayerId;

  useEffect(() => {
    const onConnect = () => { setConnected(true); setNotice('Connected to the arena.'); };
    const onDisconnect = () => { setConnected(false); setNotice('Connection lost. Reconnecting… timers keep running.'); };
    const onUpdate = payload => {
      const incoming = payload.room;
      const challengeKey = `${incoming.status}:${incoming.challenge?.id || 'none'}:${incoming.challengeNumber}:${Boolean(incoming.reveal)}`;
      if (challengeKeyRef.current !== challengeKey) { setAnswer(''); challengeKeyRef.current = challengeKey; }
      setRoom(incoming); setMyPlayerId(payload.myPlayerId); setError('');
      if (incoming.status === 'finished') setNotice('Match complete. Check the final scoreboard.');
    };
    const onSessionReplaced = () => { setNotice('This session was reconnected in another tab or device.'); socket.disconnect(); };
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); socket.on('room:update', onUpdate); socket.on('session:replaced', onSessionReplaced);
    const existing = readSession();
    if (existing?.code && existing?.sessionToken) {
      const attempt = () => emitAck('room:join', { code: existing.code, sessionToken: existing.sessionToken, nickname: existing.nickname || 'Player' }).then(result => {
        if (result.ok) { setSession(existing); setRoomCode(existing.code); setNotice(result.reconnected ? 'Welcome back — your session and score are restored.' : 'Rejoined the room.'); }
        else { clearSession(); setSession(null); }
      });
      if (socket.connected) attempt(); else socket.once('connect', attempt);
    }
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('room:update', onUpdate); socket.off('session:replaced', onSessionReplaced); };
  }, []);

  useEffect(() => {
    if (!room?.deadline) { setSecondsLeft(0); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000)));
    tick(); const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [room?.deadline]);

  const enterRoom = useCallback(async (mode) => {
    setError(''); setNotice(''); setBusy(true);
    try {
      const result = mode === 'create'
        ? await emitAck('room:create', { nickname })
        : await emitAck('room:join', { code: roomCode, nickname });
      if (!result.ok) { setError(result.error || 'Could not enter the room.'); return; }
      const next = { code: result.code, sessionToken: result.sessionToken, nickname: nickname.trim() || readSession()?.nickname || 'Player' };
      saveSession(next); setSession(next); setRoomCode(result.code); setNotice(result.reconnected ? 'Reconnected to your existing game.' : mode === 'create' ? 'Room created. Invite your teammates!' : 'You joined the room.');
    } catch { setError('Could not reach the game server. Make sure the server is running.'); }
    finally { setBusy(false); }
  }, [nickname, roomCode]);

  const startMatch = async () => { setError(''); const result = await emitAck('match:start', {}); if (!result.ok) setError(result.error); };
  const restartMatch = async () => { setError(''); const result = await emitAck('match:restart', {}); if (!result.ok) setError(result.error); else setNotice('New lobby opened. The host can start the next match when everyone is ready.'); };
  const submitAnswer = async value => {
    const submitted = String(value ?? answer).trim();
    if (!submitted) { setError('Enter an answer first.'); return; }
    setError(''); const result = await emitAck('answer:submit', { answer: submitted });
    if (!result.ok) setError(result.error); else { setAnswer(''); setNotice(isCollaborative ? 'Team answer locked in.' : 'Answer locked in. Good luck!'); }
  };
  const leaveRoom = () => { socket.emit('room:leave'); clearSession(); setSession(null); setRoom(null); setMyPlayerId(null); setAnswer(''); setNotice('You left the room on this device.'); setError(''); };
  const copyCode = async () => { try { await navigator.clipboard.writeText(room?.code || ''); setCopyState(true); window.setTimeout(() => setCopyState(false), 1400); } catch { setNotice(`Room code: ${room?.code}`); } };

  const bluePlayers = useMemo(() => room?.players.filter(p => p.teamId === 'blue') || [], [room]);
  const purplePlayers = useMemo(() => room?.players.filter(p => p.teamId === 'purple') || [], [room]);

  return <div className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar">
      <a className="brand" href="#home" onClick={e => { e.preventDefault(); if (!room) window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span className="brand-mark">✦</span><span>TRIVIA<span className="brand-accent">BATTLE</span></span></a>
      <div className="connection-pill"><span className={`connection-dot ${connected ? 'online' : ''}`} />{connected ? 'ARENA CONNECTED' : 'RECONNECTING'}</div>
    </header>

    {!room ? <main className="landing" id="home">
      <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> REAL-TIME MULTIPLAYER <span className="eyebrow-line" /></div>
        <h1>THINK FAST.<br /><span className="gradient-text">TEAM UP.</span><br />TAKE THE WIN.</h1>
        <p className="hero-subtitle">A neon-fueled battle of brains. Join forces, crack the clues, and outscore the other team.</p>
        <div className="feature-chips"><span>⚡ Speed scoring</span><span>◈ Team challenges</span><span>⌁ Up to 12 players</span></div>
      </div>
      <section className="entry-card panel">
        <div className="card-topline"><span className="live-pip" /> PLAYER SETUP <span className="step-label">01 / ENTER ARENA</span></div>
        <label className="field-label" htmlFor="nickname">YOUR NICKNAME</label>
        <input id="nickname" className="text-input" maxLength={18} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Choose your battle name" onKeyDown={e => { if (e.key === 'Enter' && nickname.trim().length >= 2) enterRoom('create'); }} />
        <button className="primary-button full-button" disabled={busy || nickname.trim().length < 2} onClick={() => enterRoom('create')}>{busy ? 'CONNECTING…' : '＋ CREATE A ROOM'} <span>↗</span></button>
        <div className="or-divider"><span /> OR JOIN YOUR SQUAD <span /></div>
        <label className="field-label" htmlFor="room-code">ROOM CODE</label>
        <div className="join-row"><input id="room-code" className="text-input code-input" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="ABC123" maxLength={6} /><button className="secondary-button" disabled={busy || nickname.trim().length < 2 || roomCode.trim().length !== 6} onClick={() => enterRoom('join')}>JOIN <span>→</span></button></div>
        <div className="entry-footnote"><span>♙</span> Guest play · No account required</div>
      </section>
      <div className="hero-stats"><div><strong>12</strong><span>PLAYERS MAX</span></div><i /><div><strong>25</strong><span>CHALLENGES</span></div><i /><div><strong>20<span className="small-unit">s</span></strong><span>PER CHALLENGE</span></div></div>
    </main> : <main className="game-layout">
      <section className="game-main">
        <div className="game-heading"><div><div className="eyebrow left-eyebrow"><span className="live-pip" /> NEON ARENA / ROOM {room.code}</div><h2>{room.status === 'lobby' ? 'SQUAD LOBBY' : room.status === 'finished' ? 'MATCH COMPLETE' : room.tieBreak ? 'SUDDEN DEATH' : `ROUND ${room.round} / 5`}</h2></div><button className="ghost-button" onClick={leaveRoom}>LEAVE ROOM ↗</button></div>
        {room.status === 'lobby' && <section className="lobby-card panel"><div className="lobby-intro"><div><div className="section-kicker">ROOM READY</div><h3>Gather your squad.</h3><p>Share this code with up to 11 other players. Teams balance automatically when the host starts.</p></div><button className="room-code-card" onClick={copyCode} title="Copy room code"><span>ROOM CODE</span><strong>{room.code}</strong><small>{copyState ? 'COPIED ✓' : 'CLICK TO COPY ↗'}</small></button></div>
          <div className="lobby-player-header"><span>PLAYERS IN LOBBY</span><strong>{room.players.length} <em>/ 12</em></strong></div><div className="lobby-players">{room.players.map((p, i) => <div className="player-chip" key={p.id}><span className={`avatar avatar-${i % 5}`}>{p.nickname.slice(0,1).toUpperCase()}</span><span className="player-name">{p.nickname}{p.isHost && <small>HOST</small>}</span><span className={`status-dot ${p.connected ? 'is-online' : ''}`} title={p.connected ? 'Connected' : 'Disconnected'} /></div>)}{Array.from({ length: Math.max(0, Math.min(4, 4 - room.players.length)) }, (_, i) => <div className="player-chip waiting" key={`waiting-${i}`}><span className="avatar">＋</span><span className="player-name">Waiting for player…</span></div>)}</div>
          <div className="lobby-bottom"><div className="lobby-rule"><span>◈</span><div><strong>2 BALANCED TEAMS</strong><small>Teams are assigned automatically</small></div></div>{isHost ? <button className="primary-button start-button" onClick={startMatch} disabled={room.players.length < 2}>START MATCH <span>→</span></button> : <div className="waiting-host"><span className="pulse-ring" /> WAITING FOR HOST TO START</div>}</div>
          {room.players.length < 2 && <p className="micro-note">At least 2 players are needed to begin.</p>}
        </section>}

        {['playing', 'tiebreak'].includes(room.status) && currentChallenge && <section className="challenge-panel panel">
          <div className="challenge-top"><div className="challenge-type"><span className={`type-icon ${currentChallenge.type}`}>{currentChallenge.type === 'trivia' ? '✦' : currentChallenge.type === 'word' ? '⌘' : '◈'}</span><div><span className="section-kicker">{room.tieBreak ? 'TIE-BREAKER' : `CHALLENGE ${room.challengeNumber} OF 25`}</span><strong>{room.tieBreak ? 'SUDDEN DEATH' : currentChallenge.type === 'trivia' ? 'TRIVIA BLITZ' : currentChallenge.type === 'word' ? 'WORD PUZZLE' : 'STRATEGY LAB'}</strong></div></div><div className={`timer-box ${secondsLeft <= 5 ? 'timer-danger' : ''}`}><span>TIME LEFT</span><strong>{String(secondsLeft).padStart(2, '0')}<small>s</small></strong><div className="timer-track"><span style={{ width: `${Math.max(0, Math.min(100, secondsLeft / 20 * 100))}%` }} /></div></div></div>
          {room.reveal ? <div className="reveal-state"><div className="reveal-icon">✓</div><div className="section-kicker">ANSWER REVEALED</div><h3>{room.reveal.answer}</h3><p>{room.reveal.explanation}</p><div className="reveal-countdown">NEXT CHALLENGE LOADING…</div></div> : <><div className="challenge-body"><div className="question-index">{room.tieBreak ? 'EXTRA ROUND' : `R${room.round} · Q${((room.challengeNumber - 1) % 5) + 1}`}</div><h3>{currentChallenge.prompt}</h3>{isCollaborative && <div className="collab-note"><span>◈</span> TEAM CHALLENGE — discuss together, then submit one shared answer. Correct answers are worth +100 team points.</div>}
            {currentChallenge.options?.length > 0 ? <div className="answer-options">{currentChallenge.options.map((option, i) => <button key={option} className={`answer-option ${answer === option ? 'selected' : ''}`} onClick={() => setAnswer(option)} disabled={room.answeredByMe || room.teamAnsweredByMe}><span className="option-letter">{String.fromCharCode(65+i)}</span><span>{option}</span><span className="option-arrow">↗</span></button>)}</div> : <input className="text-input answer-input" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Type your answer…" maxLength={160} disabled={room.answeredByMe || room.teamAnsweredByMe} onKeyDown={e => { if (e.key === 'Enter') submitAnswer(); }} />}
            <div className="submit-row"><div className="answer-status">{room.answeredByMe ? <><span className="status-check">✓</span> YOUR ANSWER IS LOCKED</> : room.teamAnsweredByMe && isCollaborative ? <><span className="status-check">✓</span> TEAM ANSWER LOCKED</> : isCollaborative ? 'ONE SUBMISSION PER TEAM' : 'ONE ANSWER PER PLAYER'}</div><button className="primary-button submit-button" onClick={() => submitAnswer()} disabled={room.answeredByMe || room.teamAnsweredByMe || !answer.trim() || secondsLeft <= 0}>LOCK ANSWER <span>→</span></button></div>
          </div></>}
        </section>}

        {room.status === 'finished' && <section className="results-card panel"><div className="trophy">🏆</div><div className="eyebrow">THE ARENA HAS SPOKEN</div><h3>{room.teams.find(t => t.id === room.winnerTeamId)?.name || 'Match complete'} <span className="gradient-text">WINS!</span></h3><p className="results-subtitle">Every point counted. Here's the final score.</p><div className="final-score-list">{(room.finalScores || [...room.teams].sort((a,b) => b.score-a.score)).map((t, i) => <div className={`final-score-row ${t.id === room.winnerTeamId ? 'winner-row' : ''}`} key={t.id}><span className={`team-swatch ${t.id}`} /><span className="final-team-name">{t.name}{t.id === room.winnerTeamId && <small>WINNER</small>}</span><strong>{Number(t.score).toFixed(2)} <small>PTS</small></strong><span className="rank">{i === 0 ? '01' : '02'}</span></div>)}</div><div className="results-actions">{isHost && <button className="primary-button" onClick={restartMatch}>PLAY AGAIN <span>→</span></button>}<button className="secondary-button" onClick={leaveRoom}>EXIT ARENA</button></div>{!isHost && <p className="micro-note">The host can open a new lobby for a rematch.</p>}</section>}

        {error && <div className="alert error-alert">⚠ {error}</div>}{notice && !error && <div className="notice-line">{notice}</div>}
      </section>

      <aside className="sidebar">
        <section className="scoreboard panel"><div className="panel-heading"><div><span className="section-kicker">LIVE MATCH DATA</span><h3>SCOREBOARD</h3></div><span className="live-badge"><span /> LIVE</span></div>
          {room.teams.map(team => <div className="team-score-block" key={team.id}><div className="team-score-top"><div className="team-name-wrap"><span className={`team-swatch ${team.id}`} /><div><strong>{team.name}</strong><small>{room.players.filter(p => p.teamId === team.id).length} PLAYERS</small></div></div><strong className="score-number">{Number(team.score).toFixed(2)}<small>PTS</small></strong></div><div className="score-meter"><span className={team.id} style={{ width: `${Math.max(3, Math.min(100, room.teams.length ? team.score / Math.max(1, ...room.teams.map(t => t.score)) * 100 : 3))}%` }} /></div>{room.players.filter(p => p.teamId === team.id).map(p => <div className="score-player" key={p.id}><span className={`mini-avatar ${team.id}`}>{p.nickname.slice(0,1).toUpperCase()}</span><span>{p.nickname}{p.id === myPlayerId && <em> YOU</em>}</span><strong>{Math.round(p.personalScore || 0)}</strong><span className={`status-dot ${p.connected ? 'is-online' : ''}`} /></div>)}</div>)}
          <div className="scoreboard-foot"><span>✦</span><p>Correct answers earn <strong>50 base + up to 50 speed points.</strong> Shared challenges earn <strong>100 team points.</strong></p></div>
        </section>
        <section className="rules-card panel"><div className="section-kicker">BATTLE RULES</div><div className="rule-row"><span>◷</span><div><strong>20 seconds</strong><small>Every challenge</small></div></div><div className="rule-row"><span>⚡</span><div><strong>Speed matters</strong><small>Faster correct answers score higher</small></div></div><div className="rule-row"><span>◈</span><div><strong>Work as a team</strong><small>Word + strategy answers are shared</small></div></div><div className="rule-row"><span>↻</span><div><strong>Reconnect anytime</strong><small>Timer keeps running while offline</small></div></div></section>
      </aside>
    </main>}
    <footer className="footer"><span>✦ TRIVIA BATTLE</span><span>BUILT FOR QUICK THINKERS <i>·</i> PLAY FAIR. PLAY TO WIN.</span></footer>
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
