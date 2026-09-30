// Phase 10: the Multiplayer screens (PHASE10_SPEC.md). Loaded by index.html
// next to the game; the game never imports it. It wires the menu's
// "Free-for-all multiplayer" button and loads Firebase only when that is
// chosen. Everything a player typed is shown with textContent, never as HTML.
import { LOBBY } from './config.js';
import { parseCode, parseName, formatCode } from './code.js';
import { campsFor } from './lineup.js';
import { FFA_STRATEGIES } from '../data/ffa.js';
import { strategyName, difficultyName, TEAM_TEXT } from '../theme/names.js';

const CORNER = { 1: 'north-west', 2: 'north-east', 3: 'south-east', 4: 'south-west' };
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

const state = { lobby: null, mesh: null, difficulty: 'normal', stopLobby: null };
globalThis.__net = state; // read by the browser tests

document.getElementById('start-mp')?.addEventListener('click', () => {
  state.difficulty = document.querySelector('#menu button.active[data-difficulty]')?.dataset.difficulty || 'normal';
  $('menu').hidden = true;
  build();
  show('mp-entry');
});

function build() {
  if ($('lobby')) return;
  const card = el('div', { className: 'result-card menu-card lobby-card' },
    el('h1', { className: 'brand-title', textContent: 'MULTIPLAYER' }),
    el('p', { className: 'dim', textContent: `Free-for-all with friends: up to ${LOBBY.slots} players. The AI plays any empty camp.` }),
    el('section', { id: 'mp-entry' },
      el('label', { className: 'lobby-field' }, el('span', { textContent: 'Your name' }),
        el('input', { id: 'mp-name', maxLength: LOBBY.nameMax, autocomplete: 'off', placeholder: 'Shown to the other players' })),
      el('div', { className: 'result-actions' }, el('button', { id: 'mp-create', textContent: 'Create lobby' })),
      el('p', { className: 'dim', textContent: 'or join one with its match code' }),
      el('div', { className: 'lobby-join' },
        el('input', { id: 'mp-code', maxLength: 9, autocomplete: 'off', placeholder: 'ABC-DEF', autocapitalize: 'characters', spellcheck: false }),
        el('button', { id: 'mp-join', textContent: 'Join lobby' })),
      el('div', { className: 'result-actions' }, el('button', { id: 'mp-back', textContent: 'Back' }))),
    el('section', { id: 'mp-room', hidden: true },
      el('p', { className: 'dim', textContent: 'Match code: share it with the other players' }),
      el('p', { id: 'mp-code-shown', className: 'lobby-code' }),
      el('ol', { id: 'mp-players', className: 'lobby-list' }),
      el('p', { id: 'mp-hint', className: 'dim' }),
      el('div', { className: 'result-actions' },
        el('button', { id: 'mp-start', textContent: 'Start match', hidden: true }),
        el('button', { id: 'mp-leave', textContent: 'Leave' }))),
    el('section', { id: 'mp-links', hidden: true },
      el('p', { id: 'mp-links-title', className: 'lobby-title' }),
      el('ul', { id: 'mp-peers', className: 'lobby-list' }),
      el('p', { className: 'dim', textContent: 'Camps' }),
      el('ol', { id: 'mp-lineup', className: 'lobby-list' }),
      el('p', { className: 'dim', textContent: 'Playing the match together over these connections comes in the next update. This screen proves every player can reach every other one directly.' }),
      el('div', { className: 'result-actions' }, el('button', { id: 'mp-menu', textContent: 'Back to menu' }))),
    el('p', { id: 'mp-status', className: 'lobby-status', role: 'status' }));
  document.body.append(el('div', { id: 'lobby' }, card));
  $('mp-create').addEventListener('click', () => act(create));
  $('mp-join').addEventListener('click', () => act(join));
  $('mp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') act(join); });
  $('mp-back').addEventListener('click', () => { location.search = ''; });
  $('mp-leave').addEventListener('click', () => act(leave));
  $('mp-start').addEventListener('click', () => act(() => state.lobby.start()));
  $('mp-menu').addEventListener('click', () => act(async () => { await leave(); location.search = ''; }));
}

function show(section) {
  for (const id of ['mp-entry', 'mp-room', 'mp-links']) $(id).hidden = id !== section;
}
const status = (text) => { $('mp-status').textContent = text || ''; };

// Run an action with the buttons disabled; show its error instead of throwing.
async function act(fn) {
  const buttons = [...$('lobby').querySelectorAll('button')];
  buttons.forEach((b) => { b.disabled = true; });
  try { await fn(); } catch (e) { status(e.name === 'LobbyError' ? e.message : `Something went wrong: ${e.message}`); console.warn(e); }
  buttons.forEach((b) => { b.disabled = false; });
  if (state.lobby) render(state.lobby);
}

async function open() {
  status('Connecting…');
  const [{ connect }, { Lobby }] = await Promise.all([import('./firebase.js'), import('./lobby.js')]);
  const fb = await connect();
  const lobby = new Lobby(fb);
  status('');
  return lobby;
}

function nameOrError() {
  const { name, error } = parseName($('mp-name').value);
  if (error) { status(error); $('mp-name').focus(); }
  return name;
}

async function create() {
  const name = nameOrError();
  if (!name) return;
  const lobby = await open();
  await lobby.create(name, state.difficulty);
  enter(lobby);
}

async function join() {
  const name = nameOrError();
  if (!name) return;
  const { code, error } = parseCode($('mp-code').value);
  if (error) { status(error); $('mp-code').focus(); return; }
  const lobby = await open();
  status('Joining…');
  await lobby.join(code, name);
  status('');
  enter(lobby);
}

function enter(lobby) {
  state.lobby = lobby;
  state.stopLobby = lobby.onChange(render);
  $('mp-code-shown').textContent = formatCode(lobby.code);
  show('mp-room');
  render(lobby);
}

async function leave() {
  state.mesh?.close();
  state.stopLobby?.();
  await state.lobby?.leave();
  state.lobby = null;
  state.mesh = null;
  show('mp-entry');
  status('You left the lobby.');
}

function render(lobby) {
  if (lobby.closed) {
    state.mesh?.close();
    lobby.unwatch();
    state.lobby = null;
    show('mp-entry');
    status(lobby.closed);
    return;
  }
  const difficulty = lobby.meta?.difficulty || state.difficulty;
  const list = $('mp-players');
  list.replaceChildren(...[1, 2, 3, 4].map((n) => {
    const p = lobby.slots[n];
    const who = p ? p.name + (n === 1 ? ' (host)' : '') + (p.uid === lobby.uid ? ' — you' : '')
      : FFA_STRATEGIES[n] ? `Open — ${strategyName(FFA_STRATEGIES[n])} AI (${difficultyName(difficulty)}) if nobody joins` : '…';
    return el('li', { className: p ? 'filled' : 'open', textContent: `${TEAM_TEXT[n]}, ${CORNER[n]}: ${who}` });
  }));
  list.dataset.names = lobby.players().map((p) => p.name).join('|'); // for the tests
  const n = lobby.players().length;
  $('mp-start').hidden = !lobby.isHost;
  $('mp-start').disabled = !lobby.canStart();
  $('mp-hint').textContent = lobby.meta?.status === 'started' ? 'Starting…'
    : lobby.isHost ? (n < LOBBY.minHumans ? `Waiting for players: at least ${LOBBY.minHumans} are needed to start.` : `${n} of ${LOBBY.slots} players. Start when everyone is here.`)
      : `${n} of ${LOBBY.slots} players. Waiting for the host to start.`;
  if (lobby.meta?.status === 'started' && !state.mesh) startLinks(lobby);
}

// After the start: show the lineup and open the peer connections (mesh.js).
async function startLinks(lobby) {
  state.mesh = { close() {} }; // placeholder until the mesh module is up
  show('mp-links');
  renderLineup(lobby);
  const { Mesh } = await import('./mesh.js');
  if (!state.lobby) return;
  state.mesh = new Mesh(lobby, () => renderLinks(lobby));
  renderLinks(lobby);
  state.mesh.start();
}

function renderLineup(lobby) {
  const lineup = lobby.meta.lineup;
  const camps = campsFor(lineup, lobby.meta.difficulty);
  $('mp-lineup').replaceChildren(...[...lineup].map((c, i) => {
    const team = i + 1;
    const who = c === 'H' ? (lobby.slots[team]?.name ?? 'a player who left') : `${strategyName(camps[team].strategy)} AI (${difficultyName(camps[team].difficulty)})`;
    return el('li', { textContent: `${TEAM_TEXT[team]}, ${CORNER[team]}: ${who}`, className: c === 'H' ? 'filled' : 'open' });
  }));
  $('mp-lineup').dataset.lineup = lineup;
}

function renderLinks(lobby) {
  const mesh = state.mesh;
  if (!mesh?.peers) return;
  const peers = [...mesh.peers.values()];
  $('mp-peers').replaceChildren(...peers.map((p) => el('li', {
    className: `peer peer-${p.state}`,
    textContent: `${p.name}: ${PEER_TEXT[p.state]}${p.state === 'verified' ? ` (test message round trip ${p.rtt} ms)` : ''}`,
  })));
  const done = peers.filter((p) => p.state === 'verified').length, failed = peers.filter((p) => p.state === 'failed').length;
  $('mp-links-title').textContent = done === peers.length ? `Connected directly to all ${peers.length} other player${peers.length > 1 ? 's' : ''}.`
    : failed ? `Connected to ${done} of ${peers.length}. ${failed} could not connect directly (a strict network or firewall).`
      : `Connecting to ${peers.length} other player${peers.length > 1 ? 's' : ''}…`;
}

const PEER_TEXT = {
  waiting: 'waiting for its answer',
  connecting: 'connecting',
  open: 'connected, testing',
  verified: 'connected, test message received',
  failed: 'could not connect directly',
};
