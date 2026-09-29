import { World } from '../sim/world.js';
import { Match } from '../ai/match.js';
import { DIFFICULTY } from '../data/difficulty.js';
import { STRATEGIES } from '../data/strategies.js';
import { FFA_MAP, FFA_STRATEGIES } from '../data/ffa.js';
import { STRATEGY_TEXT, strategyName, difficultyName } from '../theme/names.js';
import { GameScene } from './scene.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Tutorial } from './tutorial.js';
import { drawEmblem } from './emblem.js';
import { blockNativeZoom } from './nozoom.js';

const Phaser = globalThis.Phaser;
const params = new URLSearchParams(location.search);
const mode = params.get('mode');
blockNativeZoom(); // Phase 6: rapid taps are game input, never a browser zoom

// No mode chosen yet: show the start screen. Its choices become URL params, so
// "Play again" simply reloads the same setup.
if (mode !== 'match' && mode !== 'sandbox' && mode !== 'ffa') {
  showMenu();
} else {
  start(mode);
}

function showMenu() {
  const menu = document.getElementById('menu');
  menu.hidden = false;
  drawEmblem(document.getElementById('emblem'));
  let difficulty = 'normal';
  const buttons = menu.querySelectorAll('button[data-difficulty]');
  const describe = () => {
    const d = DIFFICULTY[difficulty];
    document.getElementById('difficulty-note').textContent =
      `${difficultyName(difficulty)}: plays ${strategyName(d.strategy)} by default. Decides every ${d.decisionInterval}s, reacts to scouting after ${d.reactionDelay}s.`;
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.difficulty === difficulty));
  };
  buttons.forEach((b) => b.addEventListener('click', () => { difficulty = b.dataset.difficulty; describe(); }));
  describe();
  const select = document.getElementById('strategy');
  for (const o of select.options) if (STRATEGY_TEXT[o.value]) o.textContent = strategyName(o.value); // one source of truth: src/theme
  const describeStrategy = () => {
    const id = select.value === 'auto' ? DIFFICULTY[difficulty].strategy : select.value;
    document.getElementById('strategy-note').textContent = `${strategyName(id)}: ${STRATEGY_TEXT[id].description}`;
  };
  select.addEventListener('change', describeStrategy);
  buttons.forEach((b) => b.addEventListener('click', describeStrategy));
  describeStrategy();
  document.getElementById('start-match').addEventListener('click', () => {
    const strategy = document.getElementById('strategy').value;
    location.search = `?mode=match&difficulty=${difficulty}&strategy=${strategy}`;
  });
  document.getElementById('start-ffa').addEventListener('click', () => { location.search = `?mode=ffa&difficulty=${difficulty}`; });
  document.getElementById('start-sandbox').addEventListener('click', () => { location.search = '?mode=sandbox'; });
}

function start(mode) {
  const seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e6);
  const difficulty = DIFFICULTY[params.get('difficulty')] ? params.get('difficulty') : 'normal';
  const strategy = STRATEGIES[params.get('strategy')] ? params.get('strategy') : 'auto';
  let match = null, world;
  if (mode === 'match') {
    match = new Match({ seed, PF: globalThis.PF, ai: { strategy, difficulty } });
    world = match.world;
  } else if (mode === 'ffa') { // Phase 6: four camps; the AI camps' scripts are fixed (FFA_STRATEGIES)
    const camps = Object.fromEntries(Object.entries(FFA_STRATEGIES).map(([team, s]) => [team, { strategy: s, difficulty }]));
    match = new Match({ seed, PF: globalThis.PF, ffa: { map: FFA_MAP, camps } });
    world = match.world;
  } else {
    world = new World({ seed, PF: globalThis.PF, setup: 'start' });
  }
  const hud = new Hud();
  hud.brains = match ? match.brains : null; // the dev panel's targeting view (Phase 7)
  const touch = setupInputMode(); // Phase 4: touch chrome when the device is touch-first
  const sfx = new Sfx();
  const scene = new GameScene(world, hud, sfx, match ? () => match.step() : () => world.step());
  hud.setOpponent(match ? { difficulty: difficultyName(difficulty), strategy: strategyName(match.ai.strategyId), ffa: mode === 'ffa' } : null);

  // Audio may only start after a user gesture.
  let greeted = false;
  for (const ev of ['pointerdown', 'keydown']) {
    addEventListener(ev, () => {
      sfx.unlock();
      if (match && !greeted) { greeted = true; sfx.ui('start'); } // the match-start horn, on the first gesture
    }, { capture: true });
  }
  addEventListener('keydown', (e) => { if (e.code === 'KeyM') hud.setMuted(sfx.toggleMute()); });
  hud.setMuted(sfx.muted);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#15120d',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene,
    banner: false,
  });

  touch.onChange((on) => { scene.touchMode = on; });
  scene.touchMode = touch.on;
  hud.touchMode = touch.on;
  hud.setMuted(sfx.muted); // wording depends on the input mode
  touch.onChange((on) => { hud.touchMode = on; hud.setMuted(sfx.muted); });
  scene.speed = Math.min(16, Math.max(1, Math.round(Number(params.get('speed')) || 1)));
  hud.bindTouchBar(() => scene.ui, scene);
  const tutorial = startTutorial(sfx, !!match, touch.on ? 'touch' : 'mouse');
  touch.onChange((on) => tutorial.setMode(on ? 'touch' : 'mouse'));
  hud.onSoundTap = () => hud.setMuted(sfx.toggleMute());
  setInterval(() => { if (scene.ui && !world.result) tutorial.update(world, scene.ui); }, 250);

  // Handle for e2e tests and debugging.
  window.__game = { world, scene, game, sfx, match, tutorial };
}

// Touch mode: on for coarse-pointer devices or after the first touch, or forced
// with ?input=touch / ?input=mouse. Both input schemes always work; this only
// decides whether the touch chrome (action bar, bigger targets) is shown.
function setupInputMode() {
  const forced = params.get('input');
  const listeners = [];
  const state = {
    on: forced === 'touch' || (forced !== 'mouse' && !!globalThis.matchMedia?.('(pointer: coarse)').matches),
    onChange(fn) { listeners.push(fn); },
  };
  const apply = () => {
    document.body.classList.toggle('touch', state.on);
    document.getElementById('touchbar').hidden = !state.on;
    for (const fn of listeners) fn(state.on);
  };
  if (forced !== 'mouse') {
    addEventListener('touchstart', () => { if (!state.on) { state.on = true; apply(); } }, { capture: true, passive: true });
  }
  apply();
  return state;
}

// The first-run hint panel (see tutorial.js); Help brings it back.
function startTutorial(sfx, isMatch, mode) {
  const panel = document.getElementById('tutorial');
  const render = (v) => {
    panel.hidden = !v;
    if (!v) return;
    document.getElementById('tutorial-step').textContent = v.final ? 'done' : `${v.index} / ${v.total}`;
    document.getElementById('tutorial-text').innerHTML = v.text;
    document.getElementById('tutorial-skip').textContent = v.final ? 'Got it' : 'Skip';
  };
  const tutorial = new Tutorial({ render, onAdvance: () => sfx.ui('hint'), match: isMatch, mode });
  document.getElementById('tutorial-skip').addEventListener('click', () => tutorial.finish());
  document.getElementById('help').addEventListener('click', () => {
    Tutorial.reset();
    Object.assign(tutorial, new Tutorial({ render, onAdvance: () => sfx.ui('hint'), match: isMatch, mode: tutorial.mode }));
  });
  return tutorial;
}
