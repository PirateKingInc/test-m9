// Phase 11: playing a multiplayer free-for-all (PHASE11_SPEC.md). Starts the
// match once Phase 10's connections are verified (or rejoins one after a
// reload), and runs it: the lockstep, driven by a metronome that keeps time
// even in a background tab; the game screen (src/game, unchanged apart from
// the local player's camp); and a small panel for waiting, notices and chat.
import { NET } from './net-rules.js';
import { Lockstep, lobbyMatch, humansOf } from './lockstep.js';
import { Session } from './session.js';
import { Links } from './links.js';
import { ready } from './ice.js';
import { presence } from './presence.js';
import { installDetMath } from './detmath.js';
import { TEAM_TEXT } from '../theme/names.js';
import { setPlayer } from '../game/player.js';

const KEY = 'dm-mp'; // this tab's match, for rejoining after a reload
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

export const savedMatch = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
const saveMatch = (m) => { try { sessionStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ } };
export const forgetMatch = () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

// Handles for the browser tests, on the same object the lobby screens use.
const expose = (o) => Object.assign((globalThis.__net ||= {}), o);

// Names and uids by slot, from the lobby's slots.
function roster(slots, lineup) {
  const names = {}, uids = {};
  for (const s of humansOf(lineup)) { names[s] = slots[s]?.name || TEAM_TEXT[s]; uids[s] = slots[s]?.uid; }
  return { names, uids };
}

// Right after Phase 10's mesh verified every pair: start the match. Returns
// false (and starts nothing) unless every pair is verified with an open
// channel at this moment.
export async function startMatch(lobby, mesh) {
  const peers = [...(mesh.peers?.values() || [])];
  if (!peers.length || !peers.every((p) => p.state === 'verified' && p.channel?.readyState === 'open')) return false;
  const { meta, slot: me, fb, code } = lobby;
  const { names, uids } = roster(lobby.slots, meta.lineup);
  saveMatch({ code, slot: me, names, uids, meta: { seed: meta.seed, lineup: meta.lineup, difficulty: meta.difficulty } });
  await lobby.keepForMatch();
  mesh.close = () => {}; // the links own the channels now
  const others = Object.fromEntries(Object.entries(uids).filter(([s]) => Number(s) !== me));
  const links = new Links({ fb, code, me, uid: fb.uid, slots: others });
  for (const p of mesh.peers.values()) links.adopt(p.slot, p.pc, p.channel);
  const uninstall = installDetMath(); // before the match is built: every peer alike
  const ls = new Lockstep({ match: lobbyMatch(meta, globalThis.PF), humans: humansOf(meta.lineup), me });
  run({ fb, code, me, names, uids, links, ls, uninstall });
  return true;
}

// After a reload: the same tab (same anonymous id) rejoins its match.
export async function rejoinMatch(saved, fb) {
  const { code, slot: me, names, uids, meta } = saved;
  const status = (await fb.get(fb.ref(fb.db, `lobbies/${code}/meta/status`))).val();
  if (status !== 'started') { forgetMatch(); return false; }
  const others = Object.fromEntries(Object.entries(uids).filter(([s]) => Number(s) !== me));
  await ready(); // Phase 12b: a fresh relay credential (this is a new page)
  const links = new Links({ fb, code, me, uid: fb.uid, slots: others, returning: true });
  const uninstall = installDetMath();
  run({ fb, code, me, names, uids, links, ls: null, uninstall, meta });
  return true;
}

function run({ fb, code, me, names, uids, links, ls, uninstall }) {
  const pres = presence(fb, code, fb.uid);
  const humans = Object.keys(uids).map(Number).sort((a, b) => a - b);
  const session = new Session({
    ls, me, humans, names,
    transport: { send: (s, m) => links.send(s, m), connected: (s) => links.connected(s), now: () => performance.now() },
    arbiter: { online: pres.online, present: (s) => pres.present(uids[s]) },
  });
  links.onMessage = (s, m) => session.receive(s, m);
  links.onUp = (s) => session.linkUp(s);
  links.start();
  expose({ session, links, presence: pres });
  const ui = panel(session, names, me);
  session.onNotice = (n) => ui.notice(n);
  session.onChat = (c) => ui.chat(c);
  session.onDesync = () => ui.fatal('Desync detected: the players\' games no longer match. The match cannot continue.');
  session.onHeldOut = () => { ui.notice({ text: 'Rejoining…' }); setTimeout(() => location.reload(), 500); };

  let game = null;
  const begin = () => {
    if (game) return;
    game = play(session, me, names);
    expose({ game });
  };
  if (session.mode === 'play') begin();
  else session.onRejoined = () => begin();

  // The metronome: a worker's timer keeps running in a background tab, where
  // a page's timers and animation frames are throttled or stopped. Every
  // player's game waits for every other's turns, so it must keep time.
  let last = performance.now(), acc = 0;
  const tick = () => {
    const now = performance.now();
    acc = Math.min(acc + (now - last) * NET.speed, 2000 * NET.speed);
    last = now;
    session.pump();
    if (session.mode === 'play' && !session.desync && game) {
      let budget = session.stepBudget(Math.floor(acc / 50));
      // This frame's pace is unchanged: a player whose turns are needed runs
      // up to the turns it had committed when the frame began, as when turns
      // were only committed once a frame (a held, returning player is not
      // limited by its own turns). Handback relies on that pace: CI run
      // 36883494112 with no limit left a returning player 30 ticks behind.
      const ls = session.ls, limit = ls.nextCommit;
      while (budget-- > 0) {
        if (ls.isHuman(ls.me, ls.tick) && ls.tick >= limit) { acc = Math.min(acc, 50); break; }
        if (!ls.step()) { acc = Math.min(acc, 50); break; }
        acc = Math.max(0, acc - 50);
        // But keep this player's turns committed `delay` ticks ahead after
        // every tick, not only once a frame: when a frame runs more ticks than
        // the delay (faster than real time, or catching up), it could otherwise
        // reach a tick whose turn was still open, and a UI command given then
        // ran with no input delay (CI run 36873821731: given and run at tick 17).
        for (const turn of ls.commit()) session.broadcast(turn);
      }
      if (session.ls.done) { forgetMatch(); }
    }
    ui.status({ ...session.status(), online: pres.online() });
  };
  metronome(50, tick);
  addEventListener('pagehide', () => { links.close(); pres.stop(); uninstall(); });
}

// The game screen for this peer's camp, over the lockstep's world.
async function play(session, me, names) {
  const { launch } = await import('../game/main.js');
  const ls = session.ls;
  setPlayer(me);
  // The UI's commands go to the lockstep (4 ticks later, on every peer),
  // never straight to the world.
  const uiWorld = new Proxy(ls.world, { get: (t, p) => (p === 'issue' ? (cmd) => ls.local(cmd) : Reflect.get(t, p, t)) });
  $('menu').hidden = true;
  if ($('lobby')) $('lobby').hidden = true;
  const g = launch({ world: uiWorld, gameWorld: ls.world, match: ls.match, stepSim: () => false, tutorialOn: false,
    opponent: { ffa: true, difficulty: 'Multiplayer' } });
  $('opponent').textContent = `Multiplayer free-for-all · you are ${TEAM_TEXT[me]}`;
  // Play again / Change difficulty lead back to the menu, not into this match.
  const show = g.hud.showResult.bind(g.hud);
  g.hud.showResult = (r, doc) => { forgetMatch(); show(r, doc); for (const id of ['play-again', 'change-difficulty']) { const b = $(id); if (b) b.onclick = () => { location.search = ''; }; } };
  return g;
}

// Chat is on demand: a Chat button in the touch action bar (beside Order,
// Attack, Stop, Box, Cancel, Base; on a desktop, one in the top bar and the
// Enter key) opens a panel with the log and an input; the same button, the
// panel's ✕ or Escape closes it. Closed, nothing of it lies over the map; a
// badge on the button counts lines that came in since it was last open.
// Open, it sits bottom-right just above the row of group slots, never over
// the action bar or the slots (where the bar leaves too little room above
// that line, as on a landscape phone, it sits just left of the bar), and only
// its input and ✕ take touches: the rest lets pans, pinches and taps through
// to the map.
const CHAT_GAP = 6, CHAT_MIN_LOG = 48, KEYBOARD_MIN = 100;
// The tallest the page has been at this width (no keyboard): a keyboard is up
// when the visible area is clearly shorter than that.
const fullHeight = new Map();
function placeChat() {
  const chat = $('net-chat'), log = $('net-chat-log'), input = $('net-chat-input'), head = $('net-chat-head'), row = $('net-chat-row');
  if (!chat || chat.hidden) return;
  const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
  // The visible part of the page, in page coordinates. A phone keyboard
  // shrinks it: iOS and Chrome on Android shrink the visual viewport (and
  // scroll the page to the focused field); others resize the page itself.
  const vv = window.visualViewport;
  const vis = vv ? { l: vv.pageLeft, t: vv.pageTop, w: vv.width, h: vv.height } : { l: scrollX, t: scrollY, w: W, h: H };
  const typing = document.activeElement === input;
  if (!typing) fullHeight.set(W, Math.max(fullHeight.get(W) || 0, H, vis.h));
  const keyboard = typing && vis.h < (fullHeight.get(W) || H) - KEYBOARD_MIN;
  chat.classList.toggle('docked', keyboard);
  if (keyboard) {
    // Typing with the keyboard up: dock across the bottom of what is still
    // visible, just above the keyboard, so the field and what is being typed
    // are always in view (the game's controls are under the keyboard anyway).
    chat.style.left = `${vis.l + 8}px`;
    chat.style.right = 'auto';
    chat.style.width = `${vis.w - 16}px`;
    const fixed = row.offsetHeight + head.offsetHeight + 12;
    log.style.maxHeight = `${Math.max(0, Math.min(66, vis.h - fixed - 2 * CHAT_GAP))}px`;
    log.scrollTop = log.scrollHeight; // the newest lines, in full
    chat.style.bottom = 'auto';
    chat.style.top = `${vis.t + vis.h - chat.offsetHeight - CHAT_GAP}px`;
    return;
  }
  chat.style.left = chat.style.width = '';
  const rect = (id) => { const e = $(id); if (!e || e.hidden || e.offsetParent === null) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? r : null; };
  const top = rect('hud-top'), bottom = rect('hud-bottom'), groups = rect('groups'), bar = rect('touchbar');
  const line = Math.min(bottom ? bottom.top : H, groups ? groups.top : H) - CHAT_GAP; // the panel's bottom edge
  const ceilingAll = (top ? top.bottom : 0) + CHAT_GAP;
  const w = chat.offsetWidth, fixed = row.offsetHeight + head.offsetHeight + 8;
  let right = 8, ceiling = ceilingAll;
  const overBar = (r) => bar && W - r - w < bar.right && W - r > bar.left;
  if (overBar(right)) {
    ceiling = Math.max(ceiling, bar.bottom + CHAT_GAP);
    if (line - ceiling < fixed + CHAT_MIN_LOG) { right = W - bar.left + CHAT_GAP; ceiling = ceilingAll; } // beside the bar instead
  }
  chat.style.top = 'auto';
  chat.style.right = `${right}px`;
  chat.style.bottom = `${Math.max(0, H - line)}px`;
  log.style.maxHeight = `${Math.max(0, Math.min(140, line - ceiling - fixed))}px`;
}

// A metronome: a tiny worker posting a message every `ms`; a page timer if
// workers are unavailable.
function metronome(ms, fn) {
  try {
    const src = `setInterval(() => postMessage(0), ${ms});`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = fn;
    return;
  } catch { /* no workers */ }
  setInterval(fn, ms);
}

// ---- the panel: waiting, notices, chat ------------------------------------------

function panel(session, names, me) {
  const box = el('div', { id: 'net-panel' },
    el('div', { id: 'net-status', hidden: true }),
    el('div', { id: 'net-notices' }),
    el('div', { id: 'net-chat', hidden: true },
      el('div', { id: 'net-chat-head' }, el('span', { textContent: 'Chat' }),
        el('button', { id: 'net-chat-close', type: 'button', title: 'Close the chat', textContent: '✕' })),
      el('div', { id: 'net-chat-log' }),
      el('div', { id: 'net-chat-row' },
        el('input', { id: 'net-chat-input', maxLength: NET.chatMax, placeholder: 'Message', autocomplete: 'off', enterKeyHint: 'send' }),
        el('button', { id: 'net-chat-send', type: 'button', title: 'Send (or press Enter)', textContent: '➤' }))));
  document.body.append(box);
  // The toggles: one in the touch action bar, one in the top bar for a mouse.
  const badge = () => el('b', { className: 'net-unread', hidden: true });
  const barBtn = el('button', { type: 'button', title: 'Chat with the other players' }, '✉', el('span', { textContent: 'Chat' }), badge());
  barBtn.dataset.chat = '';
  $('touchbar')?.append(barBtn);
  const topBtn = el('button', { id: 'net-chat-toggle', type: 'button', title: 'Chat with the other players (Enter)' }, 'Chat', badge());
  $('help')?.before(topBtn);
  const chat = $('net-chat'), input = $('net-chat-input');
  let unread = 0;
  const showUnread = () => {
    for (const b of document.querySelectorAll('.net-unread')) { b.hidden = !unread; b.textContent = unread > 9 ? '9+' : String(unread); }
    for (const t of [barBtn, topBtn]) t.classList.toggle('open', !chat.hidden);
  };
  const setOpen = (open, { focus = false } = {}) => {
    chat.hidden = !open;
    if (open) { unread = 0; placeChat(); const log = $('net-chat-log'); log.scrollTop = log.scrollHeight; if (focus) input.focus(); }
    else input.blur();
    showUnread();
  };
  const toggle = (e) => { e.preventDefault(); setOpen(chat.hidden, { focus: !document.body.classList.contains('touch') }); };
  barBtn.addEventListener('click', toggle);
  topBtn.addEventListener('click', toggle);
  $('net-chat-close').addEventListener('click', () => setOpen(false));
  // Enter opens the chat from the game (a keyboard); Escape closes it.
  addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && chat.hidden && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); setOpen(true, { focus: true }); }
  });
  addEventListener('resize', placeChat);
  // A phone keyboard opening or closing changes the visual viewport.
  window.visualViewport?.addEventListener('resize', placeChat);
  window.visualViewport?.addEventListener('scroll', placeChat);
  input.addEventListener('focus', () => { placeChat(); setTimeout(placeChat, 300); }); // and again once the keyboard is up
  input.addEventListener('blur', () => setTimeout(placeChat, 50));
  setInterval(placeChat, 500); // the HUD's layout changes with input mode and orientation
  // Typing is not playing: keys in the chat box never reach the game.
  for (const ev of ['keydown', 'keyup', 'keypress']) input.addEventListener(ev, (e) => e.stopPropagation());
  // Send: the ➤ button or Enter. The button never takes the focus from the
  // field, so a phone keyboard stays up for the next line.
  const sendBtn = $('net-chat-send');
  const send = () => { if (session.chat(input.value)) input.value = ''; sendBtn.disabled = !input.value.trim(); };
  sendBtn.disabled = true;
  input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });
  // (Cancelling pointerdown/mousedown keeps the focus in the field; touchstart
  // must not be cancelled: that would cancel the tap's click too.)
  for (const ev of ['pointerdown', 'mousedown']) sendBtn.addEventListener(ev, (e) => { if (document.activeElement === input) e.preventDefault(); });
  sendBtn.addEventListener('click', () => { const typing = document.activeElement === input || !document.body.classList.contains('touch'); send(); if (typing) input.focus(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
    if (e.key === 'Escape') setOpen(false);
  });
  const notices = $('net-notices');
  return {
    notice(n) {
      const line = el('div', { className: `net-notice net-${n.kind || 'info'}`, textContent: n.text });
      notices.append(line);
      while (notices.children.length > 4) notices.firstChild.remove();
      setTimeout(() => line.remove(), 12000);
    },
    chat(c) {
      const log = $('net-chat-log');
      log.append(el('div', { className: 'net-chat-line' }, el('b', { textContent: `${c.s === me ? 'You' : c.name}: ` }), c.text));
      while (log.children.length > 30) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
      if (chat.hidden && c.s !== me) { unread++; showUnread(); }
      placeChat();
    },
    status(st) {
      const s = $('net-status');
      let text = '';
      if (st.mode === 'rejoining') text = 'Rejoining the match…';
      else if (st.mode === 'waiting') text = 'Waiting for another player to come back…';
      else if (st.waiting.length && !st.online) text = 'Connection lost. Reconnecting…'; // this tab is the one cut off: it waits, it never takes anyone over
      else if (st.waiting.length && st.waiting.some((w) => w.silentMs > 1000)) {
        text = `Waiting for ${st.waiting.map((w) => `${w.name} (${Math.round(w.silentMs / 1000)} s)`).join(', ')}…`;
      }
      if (st.desync) text = s.dataset.fatal || 'Desync detected.';
      s.hidden = !text;
      if (text) s.textContent = text;
      s.dataset.mode = st.mode;
      document.body.dataset.netMode = st.mode;
    },
    fatal(text) { const s = $('net-status'); s.dataset.fatal = text; s.textContent = text; s.hidden = false; s.classList.add('net-fatal'); },
  };
}
