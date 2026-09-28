// The visual reference sheet (sheet.html -> docs/reference-sheet.png): every
// unit, every building in each construction state and every gold-mine stage,
// for both teams, at the in-game zoom levels 1x, 0.5x and 0.35x (Phase 5's
// minimum). Zoomed-out units include the in-game enlargement (src/game/sprites.js).
import { bakeAll, bakeTerrain, unitKey, buildingKey, crystalKey, ringKey, unitBoost, ART_SCALE, RING_R, TEAMS } from './atlas.js';
import { UNIT_TYPES } from './units.js';
import { BUILDING_TYPES, STATES } from './buildings.js';
import { CRYSTAL_STAGES } from './terrain.js';
import { UNITS } from '../data/units.js';
import { GAME_TITLE, TEAM_TEXT, unitName, buildingName } from '../theme/names.js';

const Phaser = globalThis.Phaser;
const W = 1800;
// Three columns: 1x, 0.5x and Phase 5's minimum zoom 0.35x, each [x0, unit spacing, building spacing].
const COLS = [[1, 40, 112, 150, 160], [0.5, 800, 86, 80, 90], [0.35, 1320, 78, 64, 70]];
const LABEL = { fontFamily: 'Georgia, serif', fontSize: '13px', color: '#f1e4c3' };
const HEAD = { fontFamily: 'Georgia, serif', fontSize: '18px', fontStyle: 'bold', color: '#e8b64c' };

class Sheet extends Phaser.Scene {
  create() {
    bakeAll(this.textures);
    // A small terrain sample: a ridge with a gap and an outcrop.
    const rockAt = new Set(['3,0', '3,1', '3,2', '3,4', '3,5', '8,2', '9,2', '8,3', '9,3']);
    const grid = { cols: 12, rows: 6, tile: 32, idx: (x, y) => `${x},${y}`, rock: new Proxy({}, { get: (_, k) => rockAt.has(k) }) };
    bakeTerrain(this.textures, grid);
    let y = 20;
    this.add.text(20, y, `${GAME_TITLE}: sprite reference sheet, all art drawn in code. Columns: in-game zoom 1x, 0.5x and 0.35x (the minimum), units with the zoom-out enlargement.`, HEAD);
    y += 40;
    for (const team of TEAMS) {
      this.add.text(20, y, `Units, team ${team} (${TEAM_TEXT[team]}${team === 1 ? ', the player' : ''})`, HEAD); y += 30;
      for (const [zoom, x0, dx] of COLS) {
        UNIT_TYPES.filter((t) => t !== 'dummy').concat(['drone-carry']).forEach((t, i) => {
          const type = t === 'drone-carry' ? 'drone' : t, cx = x0 + 50 + i * dx, cy = y + 50;
          const boost = unitBoost(zoom);
          this.add.image(cx, cy + 4, ringKey(team)).setScale((UNITS[type].radius / RING_R / ART_SCALE) * zoom * boost);
          this.add.image(cx, cy, unitKey(type, team, t === 'drone-carry')).setScale((zoom * boost) / ART_SCALE).setRotation(-Math.PI / 2);
          const label = t === 'drone-carry' ? `${unitName('drone')} (gold)` : unitName(type);
          this.add.text(cx, cy + 46 + (i % 2) * (zoom === 1 ? 0 : 16), label, LABEL).setOrigin(0.5, 0);
        });
        this.add.text(x0, y - 4, `${zoom}x`, LABEL);
      }
      y += 136;
    }
    for (const team of TEAMS) {
      this.add.text(20, y, `Buildings, team ${team} (${TEAM_TEXT[team]}): foundation / frame / complete`, HEAD); y += 30;
      for (const [zoom, x0, , bx, by] of COLS) {
        this.add.text(x0, y - 4, `${zoom}x`, LABEL);
        BUILDING_TYPES.forEach((type, i) => STATES.forEach((st, j) => {
          const cx = x0 + 150 + j * bx, cy = y + 80 + i * by;
          this.add.image(cx, cy, buildingKey(type, team, st)).setScale(zoom / ART_SCALE);
          if (j === 0) this.add.text(x0, cy - 8, buildingName(type), LABEL);
        }));
      }
      y += 4 * 160 + 40;
    }
    this.add.text(20, y, 'Gold mines (full / worked / nearly empty) and terrain', HEAD); y += 30;
    for (const [zoom, x0] of COLS) {
      CRYSTAL_STAGES.forEach((st, i) => this.add.image(x0 + 50 + i * 90 * Math.max(zoom, 0.6), y + 50, crystalKey(st)).setScale(zoom / ART_SCALE));
      this.add.image(x0 + (zoom === 1 ? 330 : 190), y + 10, 'terrain').setOrigin(0).setScale(zoom);
    }
    y += 230;
    this.scale.resize(W, y);
    window.__sheet = { ready: true, height: y, textures: this.textures.getTextureKeys().length };
  }
}

new Phaser.Game({ type: Phaser.CANVAS, parent: 'sheet', width: W, height: 3000, backgroundColor: '#15120d', scene: Sheet, banner: false });
