// First-run tutorial (Phase 3; per input mode since Phase 4): a short, non-blocking sequence of hints that
// advance as the player does each thing. Shown until finished or skipped; the
// "done" flag lives in localStorage (guarded: storage may be unavailable).
import { PLAYER } from '../sim/constants.js';

const KEY = 'prism-tutorial-v1';

// Even reading window.localStorage can throw (blocked storage, some privacy modes).
function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
const COMBAT = new Set(['striker', 'sparker', 'bulwark', 'lancer']);
const mine = (w, kind, type) => [...w.ofKind(kind)].filter((e) => e.team === PLAYER && (!type || e.type === type));

export const STEPS = [
  { id: 'select', text: 'Drag a box around your <b>Peasants</b> (or click one) to select them.',
    touch: 'Tap a <b>Peasant</b> to select it. Double-tap one to grab all of them.',
    done: (w, ui) => ui.selection.entities(w).some((e) => e.team === PLAYER && e.type === 'drone') },
  { id: 'gather', text: '<b>Right-click a gold mine</b> to dig gold. Peasants carry it to a Storehouse.',
    touch: 'Tap <b>➜ Order</b> (right), then tap a <b>gold mine</b> to dig gold.',
    done: (w) => mine(w, 'unit', 'drone').some((d) => d.order.type === 'gather') },
  { id: 'depot', text: 'With a Peasant selected, press <kbd>W</kbd> and click to place a <b>Storehouse</b> near the gold mines.',
    touch: 'With a Peasant selected, tap <b>Storehouse</b> (bottom), drag it near the gold mines and lift your finger.',
    done: (w) => mine(w, 'building', 'depot').length > 0 },
  { id: 'foundry', text: 'Press <kbd>E</kbd> with a Peasant selected to build a <b>Barracks</b>, where your army is trained.',
    touch: 'Now tap <b>Barracks</b> the same way. Your army is trained there.',
    done: (w) => mine(w, 'building', 'foundry').length > 0 },
  { id: 'train', text: 'Select the finished Barracks and press <kbd>Q</kbd>–<kbd>R</kbd> to train soldiers. Hover a button for its counters.',
    touch: 'When the Barracks is finished, tap it, then tap a <b>unit button</b> to train it.',
    done: (w) => mine(w, 'unit').some((u) => COMBAT.has(u.type)) },
  { id: 'attack', text: 'Select your army, press <kbd>A</kbd> and click to attack-move (or right-click an enemy). <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>9</kbd> saves a group.',
    touch: 'Select your army (double-tap or <b>▭ Box</b>), tap <b>⚔ Attack</b>, then tap where to fight. Hold a group slot to save it.',
    done: (w) => mine(w, 'unit').some((u) => COMBAT.has(u.type) && (u.order.type === 'attack' || u.order.type === 'attackMove')) },
];

export class Tutorial {
  constructor({ storage = safeStorage(), render = () => {}, onAdvance = () => {}, match = true, mode = 'mouse' } = {}) {
    this.storage = storage;
    this.mode = mode; // 'touch' or 'mouse': which wording the hints use
    this.render = render;
    this.onAdvance = onAdvance;
    this.match = match;
    this.step = 0;
    let seen = false;
    try { seen = storage?.getItem(KEY) === 'done'; } catch { /* storage unavailable: show the tutorial */ }
    this.active = !seen;
    if (this.active) this.render(this.view());
  }

  view() {
    if (!this.active) return null;
    if (this.step >= STEPS.length) {
      return { index: STEPS.length, total: STEPS.length, final: true,
        text: this.match
          ? `That's the loop! <b>Storm the enemy Castle</b> in the east before it takes yours.${this.mode === 'touch' ? ' Drag to look around, pinch to zoom, ⌂ Base to come home.' : ''}`
          : (this.mode === 'touch' ? "That's the loop! Drag to look around and pinch to zoom." : "That's the loop! Scroll the mouse wheel to zoom, and press <kbd>`</kbd> for the dev panel to spawn training dummies.") };
    }
    const st = STEPS[this.step];
    return { index: this.step + 1, total: STEPS.length, text: (this.mode === 'touch' && st.touch) || st.text };
  }

  // Switch wording (e.g. the first touch arrives on a device that looked like desktop).
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.active) this.render(this.view());
  }

  // Call regularly with the world and the input controller.
  update(world, ui) {
    if (!this.active || this.step >= STEPS.length) return;
    let moved = false;
    // Skip ahead past anything the player already did.
    while (this.step < STEPS.length && STEPS[this.step].done(world, ui)) { this.step++; moved = true; }
    if (moved) { this.onAdvance(this.step); this.render(this.view()); }
  }

  finish() {
    this.active = false;
    try { this.storage?.setItem(KEY, 'done'); } catch { /* storage unavailable: it just shows again next time */ }
    this.render(null);
  }

  static reset(storage = safeStorage()) {
    try { storage?.removeItem(KEY); } catch { /* ignore */ }
  }
}
