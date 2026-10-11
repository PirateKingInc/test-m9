// Ringout in the browser: the lobby screens, the arena, the controls. All of
// the networking is the DragonMarch lockstep module's public API; this file
// only says what Ringout is (its game, its pace setting, its screens).
import {
  connectFirebase, createCodes, Lobby, IceServers, Mesh, startMatch, rejoinMatch, matchStore,
  Lockstep, DEFAULT_TIMING, playersOf, metronome,
} from '../../platform/lockstep/index.js';
import { Ringout, RULES } from './sim.js';
import { Bot } from './bot.js';
import { FIREBASE_CONFIG, FIREBASE_SDK, STUN, TURN, LOBBY, CHANNEL, APP } from './config.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const COLORS = { 1: '#4aa3ff', 2: '#ff6b5b', 3: '#ffd34d', 4: '#5bdc8a' };
const COLOR_NAMES = { 1: 'Blue', 2: 'Red', 3: 'Yellow', 4: 'Green' };
const PACE_NAMES = { easy: 'Relaxed', normal: 'Normal', hard: 'Fast' };

// Tests shorten timings and point at the Firebase emulator (Playwright init scripts).
const TIMING = { ...DEFAULT_TIMING, ...(globalThis.__RINGOUT_TIMING__ || {}) };
const codes = createCodes();
const ice = new IceServers({ stun: STUN, turn: TURN });
const store = matchStore('ringout-match');
const state = (globalThis.__ringout = { lobby: null, mesh: null, run: null, starting: false });

const connect = (() => {
  let p = null;
  return () => (p ??= connectFirebase({ config: FIREBASE_CONFIG, sdk: FIREBASE_SDK, appName: 'ringout', emulator: globalThis.__RINGOUT_FIREBASE_EMULATOR__ }).catch((e) => { p = null; throw e; }));
})();

// The game, built alike on every peer from the lobby record. The deployed
// rules call the three-level setting `difficulty`; for Ringout it is the pace.
const newGame = (meta) => new Ringout({ seed: meta.seed, slots: playersOf(meta.lineup), pace: meta.difficulty });
const buildLockstep = ({ meta, me, players }) => new Lockstep({ game: newGame(meta), players, me, delay: TIMING.inputDelay });
const restore = (snap, { me, players }) => Lockstep.restore(snap, { restoreGame: Ringout.restore, players, me, delay: TIMING.inputDelay });
const runOptions = { ice, channel: CHANNEL, timing: TIMING, store, restore };

// ---- menu ----------------------------------------------------------------------

const show = (id) => { for (const s of ['entry', 'room', 'links']) $(s).hidden = s !== id; };
const status = (t) => { $('status').textContent = t || ''; };

async function act(fn) {
  const buttons = [...$('menu').querySelectorAll('button')];
  buttons.forEach((b) => { b.disabled = true; });
  try { await fn(); } catch (e) { console.warn(e); status(e.name === 'LobbyError' ? e.message : 'Multiplayer is not available right now. Try again in a moment.'); }
  buttons.forEach((b) => { b.disabled = false; });
  if (state.lobby) render(state.lobby);
}

function nameOrError() {
  const { name, error } = codes.parseName($('name').value);
  if (error) { status(error); $('name').focus(); }
  return name;
}

async function create() {
  const name = nameOrError();
  if (!name) return;
  status('Connecting…');
  const lobby = new Lobby(await connect(), { ...LOBBY, codes });
  await lobby.create(name, { difficulty: $('pace').value });
  enter(lobby);
}

async function join() {
  const name = nameOrError();
  if (!name) return;
  const { code, error } = codes.parseCode($('code').value);
  if (error) { status(error); return; }
  status('Joining…');
  const lobby = new Lobby(await connect(), { ...LOBBY, codes });
  await lobby.join(code, name);
  enter(lobby);
}

function enter(lobby) {
  status('');
  state.lobby = lobby;
  lobby.onChange(render);
  $('code-shown').textContent = codes.formatCode(lobby.code);
  show('room');
  render(lobby);
}

async function leave() {
  state.mesh?.close();
  await state.lobby?.leave();
  state.lobby = null; state.mesh = null;
  show('entry');
  status('You left the lobby.');
}

function render(lobby) {
  if (lobby.closed) { state.mesh?.close(); lobby.unwatch(); state.lobby = null; show('entry'); status(lobby.closed); return; }
  const players = lobby.players();
  $('players').replaceChildren(...[1, 2, 3, 4].map((n) => {
    const p = lobby.slots[n];
    return el('li', { textContent: `${COLOR_NAMES[n]}: ${p ? p.name + (n === 1 ? ' (host)' : '') + (p.uid === lobby.uid ? ' — you' : '') : 'open'}` });
  }));
  $('players').dataset.names = players.map((p) => p.name).join('|');
  $('start').hidden = !lobby.isHost;
  $('start').disabled = !lobby.canStart();
  const pace = PACE_NAMES[lobby.meta?.difficulty] || '';
  $('hint').textContent = lobby.meta?.status === 'started' ? 'Starting…'
    : `${players.length} of ${LOBBY.slots} players · ${pace} pace. ${lobby.isHost ? (players.length < LOBBY.minPlayers ? 'Waiting for at least one more player.' : 'Start when everyone is here.') : 'Waiting for the host to start.'}`;
  if (lobby.meta?.status === 'started' && !state.mesh) connectPeers(lobby);
}

async function connectPeers(lobby) {
  state.mesh = { close() {} };
  show('links');
  $('links-title').textContent = 'Connecting to the other players…';
  await ice.ready();
  if (!state.lobby) return;
  state.mesh = new Mesh(lobby, () => renderLinks(lobby), { channel: CHANNEL, app: APP, iceServers: () => ice.iceServers() });
  state.mesh.start();
}

function renderLinks(lobby) {
  const peers = [...state.mesh.peers.values()];
  $('peers').replaceChildren(...peers.map((p) => el('li', { className: `peer-${p.state}`, textContent: `${p.name}: ${p.state === 'verified' ? `connected (${p.rtt} ms)` : p.state === 'failed' ? `could not connect (${p.error})` : 'connecting…'}` })));
  const done = peers.filter((p) => p.state === 'verified').length;
  $('links-title').textContent = done === peers.length ? 'Everyone is connected.' : `Connected to ${done} of ${peers.length}…`;
  if (peers.length && done === peers.length && !state.starting) {
    state.starting = true;
    $('links-note').textContent = 'Starting the match…';
    setTimeout(async () => {
      const run = await startMatch({ lobby, mesh: state.mesh, buildLockstep, ...runOptions, fallbackName: (s) => COLOR_NAMES[s] }).catch((e) => { console.warn(e); return null; });
      if (run) play(run);
      else { state.starting = false; $('links-note').textContent = 'The match cannot start without a connection to every player.'; }
    }, 1500);
  }
}

// ---- the match ----------------------------------------------------------------------

function play(run) {
  state.run = run;
  const { session } = run;
  const me = session.me;
  const notice = (text) => { const n = el('div', { textContent: text }); $('notices').append(n); setTimeout(() => n.remove(), 8000); };
  const name = (s) => session.names[s] || COLOR_NAMES[s];
  session.onHeld = (s) => notice(`${name(s)} disconnected: their puck is anchored until they are back.`);
  session.onReturned = (s) => notice(s === me ? 'You are back in control.' : `${name(s)} is back.`);
  session.onDesync = () => fatal('Desync: the players\' games no longer match. The match cannot continue.');
  session.onHeldOut = () => { notice('Reconnecting…'); setTimeout(() => location.reload(), 500); };
  let screen = null;
  const begin = () => { screen ||= arena({ game: () => session.lockstep?.game, me, names: session.names, submit: (c) => session.lockstep.submit(c) }); };
  if (session.mode === 'play') begin(); else session.onRejoined = () => begin();
  run.canStep = () => !!screen;
  run.onFrame = () => {
    const st = session.status();
    let text = '';
    if (st.mode === 'rejoining') text = 'Rejoining the match…';
    else if (st.mode === 'waiting') text = 'Waiting for another player to come back…';
    else if (st.waiting.some((w) => w.silentMs > 1000)) text = `Waiting for ${st.waiting.map((w) => w.name).join(', ')}…`;
    if (!session.desync) { $('net-status').hidden = !text; $('net-status').textContent = text; }
    const g = session.lockstep?.game;
    if (g?.result && !$('result').dataset.shown) { store.forget(); result(g, me, name); }
  };
}

function fatal(text) { $('net-status').hidden = false; $('net-status').textContent = text; }

function result(g, me, name) {
  $('result').dataset.shown = '1';
  $('result').hidden = false;
  const w = g.result.winner;
  $('result-title').textContent = w === 0 ? 'A draw' : w === me ? 'You win!' : `${name(w)} wins`;
  $('result-detail').textContent = g.slots.map((s) => `${name(s)} ${g.result.score[s]}`).join(' · ');
}

// The arena: draws the game every animation frame and turns keys and
// touches into commands (sent only when they change).
function arena({ game, me, names, submit }) {
  $('menu').hidden = true;
  $('play').hidden = false;
  const canvas = $('arena'), ctx = canvas.getContext('2d');
  let dir = -1;
  const send = (d) => { if (d !== dir) { dir = d; submit({ type: 'steer', dir: d }); } };
  const dash = () => submit({ type: 'dash' });
  const keys = new Set();
  const fromKeys = () => {
    const x = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
    const y = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0);
    send(x || y ? ((Math.round((Math.atan2(y, x) * 8) / Math.PI) % 16) + 16) % 16 : -1);
  };
  addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === ' ') { e.preventDefault(); dash(); return; }
    if (/^(Arrow|[wasd]$)/.test(k)) { e.preventDefault(); keys.add(k); fromKeys(); }
  });
  addEventListener('keyup', (e) => { keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); fromKeys(); });
  // Touch: drag anywhere to steer (from where the finger went down).
  let origin = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') document.body.classList.add('touch'); origin = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!origin) return;
    const dx = e.clientX - origin.x, dy = e.clientY - origin.y;
    if (Math.hypot(dx, dy) > 12) send(((Math.round((Math.atan2(dy, dx) * 8) / Math.PI) % 16) + 16) % 16);
  });
  const lift = () => { origin = null; send(-1); };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  $('dash-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); dash(); });
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

  const draw = () => {
    requestAnimationFrame(draw);
    const g = game();
    if (!g) return;
    const W = canvas.width = canvas.clientWidth * devicePixelRatio, H = canvas.height = canvas.clientHeight * devicePixelRatio;
    const scale = Math.min(W, H) / (RULES.ringStart * 2 + 60);
    ctx.setTransform(scale, 0, 0, scale, W / 2, H / 2);
    ctx.fillStyle = '#0d1220'; ctx.fillRect(-W, -H, W * 2, H * 2);
    ctx.beginPath(); ctx.arc(0, 0, g.radius, 0, Math.PI * 2); ctx.fillStyle = '#1b2742'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = g.phaseTick > RULES.graceTicks && g.radius > RULES.ringMin ? '#ff6b5b' : '#3a4a72'; ctx.stroke();
    for (const s of g.slots) {
      const p = g.pucks[s];
      if (p.out) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y, RULES.puckRadius, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[s]; ctx.globalAlpha = g.anchored[s] ? 0.45 : 1; ctx.fill(); ctx.globalAlpha = 1;
      if (s === me) { ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); }
      if (p.cd > 0) { ctx.beginPath(); ctx.arc(p.x, p.y, RULES.puckRadius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - p.cd / RULES.dashCooldown)); ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = '#e8ecf6'; ctx.font = '600 14px system-ui'; ctx.textAlign = 'center';
      ctx.fillText((names[s] || COLOR_NAMES[s]) + (g.anchored[s] ? ' (away)' : ''), p.x, p.y - RULES.puckRadius - 8);
    }
    if (g.phase === 'pause') { ctx.fillStyle = '#e8ecf6'; ctx.font = '700 28px system-ui'; ctx.textAlign = 'center'; const w = g.history.at(-1)?.[1]; ctx.fillText(w ? `${names[w] || COLOR_NAMES[w]} takes the round` : 'No point this round', 0, 0); }
    $('scores').replaceChildren(...g.slots.map((s) => el('span', { textContent: `${names[s] || COLOR_NAMES[s]} ${g.score[s]}`, style: `color:${COLORS[s]}` })));
    $('round').textContent = `Round ${g.round} · first to ${RULES.winScore}`;
  };
  draw();
  return { draw };
}

// ---- practice: you against three bots, on this device only -------------------------

function practice() {
  const name = codes.parseName($('name').value).name || 'You';
  const g = new Ringout({ seed: 1 + Math.floor(Math.random() * 999999), slots: [1, 2, 3, 4], pace: $('pace').value });
  const bots = [2, 3, 4].map((s) => new Bot(s, g.seed));
  let mine = [];
  const names = { 1: name, 2: 'Bot Red', 3: 'Bot Yellow', 4: 'Bot Green' };
  arena({ game: () => g, me: 1, names, submit: (c) => mine.push(c) });
  const stop = metronome(TIMING.tickMs, () => {
    if (g.isOver()) { stop(); result(g, 1, (s) => names[s]); return; }
    const inputs = [{ slot: 1, commands: mine.splice(0) }, ...bots.map((b) => { const commands = []; b.act(g, (c) => commands.push(c)); return { slot: b.slot, commands }; })];
    g.step(g.tick, inputs);
  });
  state.practice = g;
}

// ---- wiring ----------------------------------------------------------------------

$('create').addEventListener('click', () => act(create));
$('join').addEventListener('click', () => act(join));
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') act(join); });
$('start').addEventListener('click', () => act(() => state.lobby.start()));
$('leave').addEventListener('click', () => act(leave));
$('back').addEventListener('click', () => act(async () => { await leave(); location.reload(); }));
$('practice').addEventListener('click', practice);
$('again').addEventListener('click', () => { store.forget(); location.reload(); });

// A tab that was in a match (and reloaded) goes straight back in.
(async () => {
  const saved = store.load();
  if (!saved) return;
  show('links');
  $('links-title').textContent = 'Rejoining your match…';
  try {
    const run = await rejoinMatch({ fb: await connect(), saved, ...runOptions });
    if (run) { play(run); return; }
  } catch (e) { console.warn(e); }
  store.forget();
  show('entry');
})();
