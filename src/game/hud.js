import { targetingHtml } from './devai.js';
import { PLAYER } from '../sim/constants.js';
import { supplyOf } from '../sim/supply.js';
import { UNITS } from '../data/units.js';
import { BUILDINGS } from '../data/buildings.js';
import { UNIT_TEXT, ATTACK_TEXT, ARMOR_TEXT, NODE_NAME, TEAM_TEXT, ZONE_TEXT, unitName, buildingName } from '../theme/names.js';

const GROUP_HOLD_MS = 500;

const nameOf = (e) => (e.kind === 'unit' ? unitName(e.type) : e.kind === 'building' ? buildingName(e.type) : NODE_NAME);

// DOM HUD overlay. Reads world state; never mutates it.
export class Hud {
  constructor(doc = document) {
    this.el = {
      lumen: doc.getElementById('lumen'),
      units: doc.getElementById('unit-count'),
      supply: doc.getElementById('supply'),
      fps: doc.getElementById('fps'),
      selection: doc.getElementById('selection-panel'),
      card: doc.getElementById('command-card'),
      toast: doc.getElementById('toast'),
      sound: doc.getElementById('sound'),
    };
    this.cardSig = '';
    this.groupsEl = doc.getElementById('groups');
    this.groupsSig = '';
    this.groupsEl.innerHTML = Array.from({ length: 9 }, (_, i) => `<button data-group="${i + 1}"><b>${i + 1}</b><span></span></button>`).join('');
    const slot = (ev) => ev.target.closest('button[data-group]');
    this.groupsEl.addEventListener('click', (ev) => {
      const b = slot(ev);
      if (!b || !this.ui) return;
      if (this.heldGroup) { this.heldGroup = false; return; } // the hold already assigned
      if (ev.shiftKey || ev.ctrlKey) this.ui.assignGroup(Number(b.dataset.group));
      else this.ui.recallGroup(Number(b.dataset.group));
    });
    // Touch (Phase 4): press and hold a slot for 0.5 s to assign; a tap recalls.
    this.groupsEl.addEventListener('pointerdown', (ev) => {
      const b = slot(ev);
      if (!b || ev.pointerType !== 'touch') return;
      this.heldGroup = false;
      b.classList.add('holding');
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => {
        b.classList.remove('holding');
        if (!this.ui) return;
        this.heldGroup = true;
        this.ui.assignGroup(Number(b.dataset.group));
        b.classList.add('assigned');
        setTimeout(() => b.classList.remove('assigned'), 500);
      }, GROUP_HOLD_MS);
    });
    const endHold = (ev) => { clearTimeout(this.holdTimer); slot(ev)?.classList.remove('holding'); };
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) this.groupsEl.addEventListener(t, endHold);
    this.groupsEl.addEventListener('contextmenu', (ev) => {
      const b = slot(ev);
      ev.preventDefault();
      if (b && this.ui) this.ui.assignGroup(Number(b.dataset.group));
    });
    const fs = doc.getElementById('fullscreen');
    fs.addEventListener('click', () => enterFullscreenWithKeyLock(doc));
    doc.addEventListener('fullscreenchange', () => { fs.textContent = doc.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'; });
    this.dev = doc.getElementById('dev-panel');
    this.el.devAi = doc.getElementById('dev-ai');
    doc.addEventListener('keydown', (ev) => { if (ev.code === 'Backquote') this.dev.hidden = !this.dev.hidden; });
    this.dev.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-spawn]');
      if (btn && this.ui) { this.ui.devSpawn = btn.dataset.spawn; this.ui.attackMode = false; this.ui.placing = null; }
    });
    // Tapping the under-attack alert jumps the camera there (Space on desktop).
    this.el.toast.addEventListener('click', () => { if (this.el.toast.classList.contains('alert')) this.onAlertTap?.(); });
    this.el.sound.addEventListener('click', () => this.onSoundTap?.()); // no M key on a phone
    this.el.selection.addEventListener('click', (ev) => {
      const slot = ev.target.closest('[data-cancel]');
      if (slot) this.ui?.action(`cancel-train:${slot.dataset.cancel}`);
    });
    this.el.card.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (btn && !btn.disabled) this.ui?.action(btn.dataset.action);
    });
    this.lastRefresh = 0;
  }

  // Touch action bar (Phase 4): buttons call the same InputController methods.
  bindTouchBar(getUi, scene, doc = document) {
    this.touchbar = doc.getElementById('touchbar');
    this.touchbar.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-touch]');
      const ui = getUi();
      if (!btn || !ui || btn.disabled) return;
      const act = btn.dataset.touch;
      if (act === 'box') ui.armBox();
      else if (act === 'base') scene.centerOnCore();
      else if (act === 'order' || act === 'attack') ui.arm(act);
      else if (act === 'stop') ui.stop();
      else if (act === 'cancel') ui.disarm();
    });
    this.banner = doc.getElementById('armed-banner');
  }

  // What the next tap will do, in words (touch only).
  armedText(ui, world) {
    if (ui.placing) return `Drag to position the ${buildingName(ui.placing)}, lift your finger to ${ui.moving != null ? 'move it there' : 'build'}. ✕ cancels.`;
    if (ui.boxArmed) return '▭ Drag a box around your units';
    if (ui.armed === 'attack') return '⚔ Tap where to attack-move: units fight anything on the way';
    if (ui.armed === 'order') {
      const units = ui.ownSelected('unit');
      if (!units.length) return '➜ Tap where new units should gather (rally point)';
      return units.some((u) => u.type === 'drone')
        ? '➜ Tap a spot to move, an enemy to attack, a gold mine to dig or a site to build'
        : '➜ Tap a spot to move there, or an enemy to attack it';
    }
    return '';
  }

  updateTouchBar(ui, world) {
    if (!this.touchbar || this.touchbar.hidden) { if (this.banner) this.banner.hidden = true; return; }
    const canOrder = ui.canOrder(), hasUnits = ui.ownSelected('unit').length > 0;
    const busy = !!(ui.armed || ui.boxArmed || ui.placing);
    const enabled = { order: canOrder, attack: hasUnits, stop: hasUnits, cancel: busy, box: true, base: true };
    for (const b of this.touchbar.querySelectorAll('button[data-touch]')) {
      const act = b.dataset.touch;
      b.disabled = !enabled[act];
      b.classList.toggle('armed', act === 'box' ? ui.boxArmed : ui.armed === act);
    }
    // Draw the eye to Order the moment it becomes useful.
    const orderBtn = this.touchbar.querySelector('[data-touch="order"]');
    if (canOrder && !this.couldOrder) { orderBtn.classList.remove('pulse'); void orderBtn.offsetWidth; orderBtn.classList.add('pulse'); }
    this.couldOrder = canOrder;
    const text = this.armedText(ui, world);
    this.banner.hidden = !text;
    if (text && this.banner.textContent !== text) this.banner.textContent = text;
  }

  setOpponent(opp, doc = document) {
    this.opponent = opp;
    if (opp) doc.getElementById('opponent').textContent = opp.ffa ? `Free-for-all · 3 rival camps · ${opp.difficulty}` : `vs AI · ${opp.difficulty}`;
    if (opp?.ffa) doc.getElementById('ffa-readout').hidden = false;
  }

  // Free-for-all (Phase 6): your zones, the camps still standing, and a card
  // when your own camp falls (the match goes on without you).
  updateFreeForAll(world, doc = document) {
    const zones = world.zones.filter((z) => z.owner === PLAYER).length;
    const out = new Set((world.eliminated || []).map((e) => e.team));
    const camps = world.teams.filter((t) => !out.has(t)).length;
    const text = `${zones}/${world.zones.length}|${camps}`;
    if (text !== this.ffaSig) {
      this.ffaSig = text;
      doc.getElementById('zones').textContent = `${zones}/${world.zones.length}`;
      doc.getElementById('camps').textContent = `${camps}/${world.teams.length}`;
    }
    const mine = (world.eliminated || []).find((e) => e.team === PLAYER);
    if (mine && !world.result && !this.shownFall) {
      this.shownFall = true;
      this.showFall(mine, doc);
    }
  }

  showFall(rec, doc = document) {
    doc.getElementById('result-title').textContent = 'Defeat';
    doc.getElementById('result-title').className = 'defeat';
    const by = rec.by ? `${TEAM_TEXT[rec.by]} took your lands and ${rec.gold} gold.` : '';
    const what = rec.reason === 'hopeless' ? 'Your camp has no army and no way left to raise one or earn gold.' : 'Your Castle has fallen.';
    doc.getElementById('result-detail').textContent = `${what} ${by ? `${by} ` : ''}The other camps fight on.`;
    const table = doc.getElementById('result-stats');
    if (table) table.innerHTML = '';
    const watch = doc.getElementById('watch-on');
    watch.hidden = false;
    watch.onclick = settled(() => { doc.getElementById('result').hidden = true; });
    doc.getElementById('result').hidden = false;
    doc.getElementById('play-again').onclick = settled(() => location.reload());
    doc.getElementById('change-difficulty').onclick = settled(() => { location.search = '?menu'; });
  }

  // A line for the free-for-all's big moments (the scene passes sim events).
  ffaEvent(e) {
    const name = (t) => (t === PLAYER ? 'You' : TEAM_TEXT[t]);
    if (e.type === 'eliminated') {
      const loot = e.by ? `: ${name(e.by)} take${e.by === PLAYER ? '' : 's'} ${e.gold} gold and ${e.zones.length} zone${e.zones.length === 1 ? '' : 's'}` : '';
      const fell = e.reason === 'hopeless' ? 'can no longer fight or earn: out of the game' : 'has fallen';
      this.toast(e.team === PLAYER ? `Your ${e.reason === 'hopeless' ? 'camp can no longer fight or earn: out of the game' : 'Castle has fallen'}${loot}` : `${TEAM_TEXT[e.team]} ${fell}${loot}`, { alert: e.team === PLAYER || e.by === PLAYER });
    } else if (e.type === 'zoneCaptured' && (e.to === PLAYER || e.from === PLAYER)) {
      this.toast(e.to === PLAYER ? `You hold ${ZONE_TEXT[e.zone]}${e.loot ? ` (+${e.loot} gold left there)` : ''}` : `${TEAM_TEXT[e.to]} took ${ZONE_TEXT[e.zone]} from you`);
    }
  }

  // Victory / Defeat / Draw screen (SPEC.md Phase 2 "Win / lose").
  showResult(r, doc = document) {
    this.shownResult = true;
    const title = r.winner === null ? 'Draw' : r.winner === PLAYER ? 'Victory' : 'Defeat';
    const who = (t) => (t === PLAYER ? 'Your camp' : TEAM_TEXT[t]);
    const why = r.standings // free-for-all (Phase 6)
      ? { 'last-standing': `${who(r.winner)} is the last camp standing.`, draw: 'The last Castles fell at the same moment.',
        'time-limit': r.winner === null ? 'Time limit reached: the leaders tied on land and score.' : `Time limit reached: ${who(r.winner)} held the most land.` }[r.reason]
      : { hopeless: r.winner === PLAYER ? 'The enemy has no army and no way left to raise one.' : 'Your camp has no army and no way left to raise one or earn gold.',
        'core-destroyed': r.winner === PLAYER ? 'The enemy Castle has fallen.' : 'Your Castle has fallen.',
        draw: 'Both Castles fell at the same moment.', 'time-limit': `Time limit reached: decided on score (${r.scores[1]} vs ${r.scores[2]}).` }[r.reason];
    const watch = doc.getElementById('watch-on');
    if (watch) watch.hidden = true;
    const mm = Math.floor(r.time / 60), ss = String(Math.floor(r.time % 60)).padStart(2, '0');
    doc.getElementById('result-title').textContent = title;
    doc.getElementById('result-title').className = title.toLowerCase();
    const opp = this.opponent && !this.opponent.ffa ? ` The AI (${this.opponent.difficulty}) played ${this.opponent.strategy}.` : '';
    doc.getElementById('result-detail').textContent = `${why} Match time ${mm}:${ss}.${opp}`;
    const table = doc.getElementById('result-stats');
    if (table && r.standings) { // free-for-all: every camp's place
      table.innerHTML = '<tr><th>#</th><th>Camp</th><th>Zones</th><th>Score</th></tr>'
        + r.standings.map((s) => `<tr><td>${s.place}</td><td>${s.team === PLAYER ? 'You' : TEAM_TEXT[s.team]}${s.eliminatedAt != null ? ' (fell)' : ''}</td><td>${s.zones}</td><td>${s.score}</td></tr>`).join('');
    } else if (table && this.stats) {
      const them = this.opponent ? 'AI' : 'Team 2';
      table.innerHTML = `<tr><th></th><th>You</th><th>${them}</th></tr>`
        + this.stats.rows(PLAYER, PLAYER === 1 ? 2 : 1).map(([k, a, b]) => `<tr><td>${k}</td><td>${a}</td><td>${b}</td></tr>`).join('');
    }
    doc.getElementById('result').hidden = false;
    doc.getElementById('play-again').onclick = settled(() => location.reload());
    doc.getElementById('change-difficulty').onclick = settled(() => { location.search = '?menu'; });
  }

  setMuted(muted) {
    this.muted = muted;
    const key = this.touchMode ? '' : ' (M)';
    this.el.sound.textContent = muted ? `Sound off${key}` : `Sound on${key}`;
  }

  toast(text, { alert = false } = {}) {
    if (!text) return;
    const el = this.el.toast;
    el.textContent = text;
    el.classList.toggle('alert', alert);
    el.classList.remove('show');
    void el.offsetWidth; // restart the fade animation
    el.classList.add('show');
  }

  update(world, fps, ui) {
    const now = performance.now();
    if (now - this.lastRefresh < 100) return;
    this.lastRefresh = now;
    let units = 0;
    for (const u of world.ofKind('unit')) if (u.team === PLAYER) units++;
    this.el.lumen.textContent = Math.floor(world.resources[PLAYER]);
    this.el.units.textContent = units;
    const sup = supplyOf(world, PLAYER);
    this.el.supply.textContent = `${sup.used}/${sup.cap}`;
    this.el.supply.classList.toggle('blocked', sup.free <= 0);
    this.el.fps.textContent = `${Math.round(fps)} fps`;
    if (world.zones) this.updateFreeForAll(world);
    if (world.zones && this.brains && !this.dev.hidden && now - (this.aiRefresh || 0) >= 500) { // Phase 7 dev view
      this.aiRefresh = now;
      const html = targetingHtml(this.brains);
      if (html !== this.aiHtml) { this.aiHtml = html; this.el.devAi.innerHTML = html; }
    }
    if (world.result && !this.shownResult) this.showResult(world.result);
    if (!ui) return;
    this.ui = ui;
    this.updateGroups(world, ui);
    this.updateTouchBar(ui, world);
    // Only touch the DOM when content changes, so buttons stay clickable.
    const sel = ui.selection.entities(world);
    const html = this.selectionHtml(world, sel);
    if (html !== this.selHtml) { this.selHtml = html; this.el.selection.innerHTML = html; }
    const bar = this.el.selection.querySelector('.queue i');
    const q = sel.length === 1 && sel[0].queue?.[0];
    if (bar && q) bar.style.width = `${Math.floor((q.progress / UNITS[q.unit].trainTime) * 100)}%`;
    const card = ui.commandCard();
    const sig = JSON.stringify(card);
    const actions = card.map((b) => b.action).join('|');
    if (sig !== this.cardSig && actions === this.cardActions) {
      // Same buttons, new state: patch them in place, so a finger that is
      // already pressing a button never has it replaced mid-tap.
      this.cardSig = sig;
      this.el.card.querySelectorAll('button[data-action]').forEach((el, i) => {
        el.disabled = !card[i].enabled;
        el.classList.toggle('active', !!card[i].active);
      });
    } else if (sig !== this.cardSig) {
      this.cardSig = sig;
      this.cardActions = actions;
      this.el.card.innerHTML = card.map((b) => `<button data-action="${b.action}" ${b.enabled ? '' : 'disabled'} class="${b.active ? 'active' : ''}" title="${tooltip(b)}">`
        + `<span class="key">${b.key}</span>${b.label}${b.cost != null ? `<span class="cost">${b.cost}</span>` : ''}</button>`).join('');
    }
  }

  updateGroups(world, ui) {
    const counts = Array.from({ length: 9 }, (_, i) => (ui.groups.groups.get(i + 1) || []).filter((id) => world.get(id)?.hp > 0).length);
    const sig = counts.join(',');
    if (sig === this.groupsSig) return;
    this.groupsSig = sig;
    this.groupsEl.querySelectorAll('button').forEach((b, i) => {
      b.querySelector('span').textContent = counts[i] ? `×${counts[i]}` : '';
      b.classList.toggle('empty', !counts[i]);
    });
  }

  queueHtml(e) {
    if (e.kind !== 'building' || !e.queue?.length) return '';
    // The first slot's progress bar is updated in place by update().
    return `<div class="queue">${e.queue.map((q, i) => `<button data-cancel="${i}" title="Cancel (full refund)">${unitName(q.unit)}${i === 0 ? '<i></i>' : ''}</button>`).join('')}</div>`;
  }

  // One line saying what the current selection can do (Phase 4 clarity).
  selectionHint(sel) {
    const t = this.touchMode;
    if (!sel.length) return t ? 'Tap a unit or building to select it. Drag to look around, pinch to zoom.' : 'Nothing selected. Left-click or drag to select; right-click to command; mouse wheel zooms.';
    const e = sel[0];
    if (e.kind === 'node') return 'Gold mine: Peasants dig gold here.';
    if (e.team && e.team !== PLAYER) return t ? 'Enemy. Select your units, tap ➜ Order, then tap it to attack.' : 'Enemy. Select your units and right-click it to attack.';
    if (e.kind === 'building' && !e.built) return 'Under construction: a Peasant must stay next to it.';
    if (e.kind === 'building') {
      if (!BUILDINGS[e.type].trains.length) return e.type === 'spire' ? 'Watchtower: shoots arrows at enemies in range.' : 'Storehouse: Peasants bring gold here.';
      return t ? 'Tap a unit button to train · ➜ Order sets the rally point.' : 'Q–R to train · right-click to set the rally point.';
    }
    if (sel.some((u) => u.type === 'drone')) return t ? 'Tap a build button, or ➜ Order then a gold mine to dig.' : 'Q–R to build · right-click a gold mine to dig.';
    return t ? '➜ Order: move or attack · ⚔ Attack: attack-move · hold a group slot to save.' : 'Right-click to move or attack · A to attack-move · Shift+1–9 saves a group.';
  }

  selectionHtml(world, sel) {
    const hint = `<div class="hint">${this.selectionHint(sel)}</div>`;
    if (!sel.length) return hint;
    if (sel.length === 1) {
      const e = sel[0];
      const stat = e.kind === 'node' ? `${Math.ceil(e.amount)} / ${e.maxAmount} gold`
        : `HP ${Math.ceil(e.hp)} / ${e.maxHp}${e.kind === 'unit' ? ` · ${e.order.type}` : ''}${e.carry ? ` · carrying ${e.carry}` : ''}`;
      const team = e.team && e.team !== PLAYER ? ' <span class="enemy">(enemy)</span>' : '';
      const building = e.kind === 'building' && !e.built ? ` · building ${Math.floor(e.progress * 100)}%` : '';
      return `<div class="sel-name">${nameOf(e)}${team}</div><div class="dim">${stat}${building}</div>${hint}${this.queueHtml(e)}`;
    }
    const counts = {};
    for (const e of sel) counts[nameOf(e)] = (counts[nameOf(e)] || 0) + 1;
    return `<div class="sel-name">${sel.length} selected</div><div class="dim">${Object.entries(counts).map(([n, c]) => `${n} ×${c}`).join(' · ')}</div>${hint}`;
  }
}

// The result and fall cards pop up in the middle of play. A tap that was
// already on its way (to the map or a unit) must not land on "Play again", so
// the card's buttons ignore taps for their first CARD_SETTLE seconds (Phase 6).
export const CARD_SETTLE = 0.8;
function settled(fn) {
  const shown = performance.now();
  return () => { if (performance.now() - shown >= CARD_SETTLE * 1000) fn(); };
}

// Command-card tooltip: name, hotkey, cost and the stats that matter (from data).
export function tooltip(b) {
  const [verb, type] = b.action.split(':');
  if (verb === 'train' && UNITS[type]) {
    const u = UNITS[type];
    const range = u.range > 20 ? `range ${u.range}` : 'melee';
    return `${unitName(type)} (${b.key}): ${UNIT_TEXT[type].role}. ${u.cost} gold, ${u.supply} supply, ${u.trainTime}s. HP ${u.hp} ${ARMOR_TEXT[u.armor]}, ${u.damage} ${ATTACK_TEXT[u.attack]} / ${u.cooldown}s, ${range}.${COUNTER_HINTS[type] ? ` ${COUNTER_HINTS[type]}` : ''}`;
  }
  if (verb === 'build' && BUILDINGS[type]) {
    const d = BUILDINGS[type];
    return `${buildingName(type)} (${b.key}): ${BUILDING_HINTS[type](d)} ${d.cost} gold, ${d.buildTime}s, HP ${d.hp}.`;
  }
  if (verb === 'move') return `Move (${b.key}): rebuild this building elsewhere for ${b.cost} gold (half its cost) in half its build time. It stops working until it is up again.`;
  return `${b.label} (${b.key})`;
}

const COUNTER_HINTS = {
  drone: 'Digs gold and builds.',
  striker: 'Beats Archers up close and Dragon Riders.',
  sparker: 'Beats Horsemen at range and Dragon Riders.',
  bulwark: 'Beats Horsemen and Archers; weak to Dragon Riders.',
  lancer: 'Its dragonfire melts Shield Knights; weak to Horsemen and Archers.',
};
const BUILDING_HINTS = {
  core: (d) => `Your seat: trains Peasants, +${d.supply} supply. Lose every Castle and you lose.`,
  depot: (d) => `Peasants bring gold here; +${d.supply} supply.`,
  foundry: () => 'Trains Horsemen, Archers, Shield Knights and Dragon Riders.',
  spire: (d) => `Defensive tower: ${d.weapon.damage} ${ATTACK_TEXT[d.weapon.attack]} / ${d.weapon.cooldown}s at range ${d.weapon.range}.`,
};

// Fullscreen plus the Keyboard Lock API: in Chrome this makes Ctrl+1-9 reach the
// page instead of switching tabs. Where either API is missing it fails quietly.
export async function enterFullscreenWithKeyLock(doc = document) {
  try {
    if (doc.fullscreenElement) { await doc.exitFullscreen(); return false; }
    await doc.documentElement.requestFullscreen();
    const keys = Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`);
    await globalThis.navigator?.keyboard?.lock?.(keys);
    return true;
  } catch {
    return false;
  }
}
