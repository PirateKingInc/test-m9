// Tile grid: static rock plus dynamic blockers (buildings, crystal nodes).
export class Grid {
  constructor(cols, rows, tile) {
    this.cols = cols;
    this.rows = rows;
    this.tile = tile;
    this.rock = new Uint8Array(cols * rows);
    this.occupant = new Int32Array(cols * rows); // entity id of building/node, 0 = none
    this.version = 0; // bumped whenever walkability changes
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }

  idx(tx, ty) {
    return ty * this.cols + tx;
  }

  isWalkable(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = this.idx(tx, ty);
    return this.rock[i] === 0 && this.occupant[i] === 0;
  }

  setRock(x, y, w, h) {
    this.forRect(x, y, w, h, (i) => { this.rock[i] = 1; });
    this.version++;
  }

  setOccupant(x, y, w, h, id) {
    this.forRect(x, y, w, h, (i) => { this.occupant[i] = id; });
    this.version++;
  }

  forRect(x, y, w, h, fn) {
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (this.inBounds(tx, ty)) fn(this.idx(tx, ty), tx, ty);
      }
    }
  }

  // True when every tile of the rect is in bounds and walkable.
  isRectFree(x, y, w, h) {
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (!this.isWalkable(tx, ty)) return false;
      }
    }
    return true;
  }

  tileOf(px, py) {
    return { tx: Math.floor(px / this.tile), ty: Math.floor(py / this.tile) };
  }

  center(tx, ty) {
    return { x: (tx + 0.5) * this.tile, y: (ty + 0.5) * this.tile };
  }

  // Walkable tiles in rings of increasing Chebyshev radius around (tx,ty), nearest first.
  // Equal-distance ties keep the Phase 1 west-to-east order in the west half and
  // use its mirror image in the east half, so both halves behave identically.
  // On maps mirrored north-south too (mirrorY), the south half likewise uses
  // the vertical mirror image of the north half's order (Phase 8).
  *spiral(tx, ty, maxR = 20) {
    if (this.isWalkable(tx, ty)) yield { tx, ty };
    const dir = tx < this.cols / 2 ? -1 : 1;
    const dirY = this.mirrorY && ty >= this.rows / 2 ? -1 : 1;
    for (let r = 1; r <= maxR; r++) {
      const ring = [];
      for (let j = -r; j <= r; j++) {
        const dy = dirY * j;
        for (let k = 0; k <= 2 * r; k++) {
          const dx = dir * (r - k);
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (this.isWalkable(x, y)) ring.push({ tx: x, ty: y, d: dx * dx + dy * dy });
        }
      }
      ring.sort((a, b) => a.d - b.d);
      for (const t of ring) yield { tx: t.tx, ty: t.ty };
    }
  }

  nearestWalkable(tx, ty, maxR = 20) {
    for (const t of this.spiral(tx, ty, maxR)) return t;
    return null;
  }

  // 0 = walkable, 1 = blocked, in the row-major matrix layout PathFinding.js expects.
  toMatrix() {
    const m = [];
    for (let ty = 0; ty < this.rows; ty++) {
      const row = new Array(this.cols);
      for (let tx = 0; tx < this.cols; tx++) row[tx] = this.isWalkable(tx, ty) ? 0 : 1;
      m.push(row);
    }
    return m;
  }
}
