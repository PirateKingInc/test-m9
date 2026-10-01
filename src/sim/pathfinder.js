// Grid routing via PathFinding.js (loaded from the CDN in the browser, from npm in tests).
export class Pathfinder {
  constructor(grid, PF) {
    if (!PF) throw new Error('PathFinding.js (PF) is required');
    this.grid = grid;
    this.PF = PF;
    // Legacy option names: the CDN browser build of 0.4.18 predates DiagonalMovement.
    // allowDiagonal + dontCrossCorners == diagonals only when no obstacle is touched.
    this.finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
    this.base = null;
    this.baseVersion = -1;
    this.searches = 0;
  }

  // A search-ready PathFinding.js grid. Instead of cloning 4800 nodes per search
  // (the old approach, a large share of match CPU time and GC), one working grid
  // is kept and each node's search fields are reset to undefined, exactly the
  // state of a fresh clone. It is rebuilt only when walkability changes.
  //
  // Mirror symmetry: queries that start in the east half run in a mirrored frame
  // (x -> cols-1-x) so A*'s fixed neighbour order, the flood fill and the
  // clearance sampling treat both halves of the map identically.
  //
  // Phase 8: on maps mirrored north-south as well (grid.mirrorY, the
  // free-for-all), queries that start in the south half also flip y
  // (y -> rows-1-y), so the north and south camps plan identically too.
  //
  // Phase 12: only the nodes the previous search touched are reset (A* reaches
  // a node only through getNodeAt or getNeighbors, both recorded), not every
  // node of the map: the same state, without a full-map sweep per search, which
  // was most of the cost of a big army's simultaneous orders.
  pfGrid(g = this.frame) {
    const key = g.frameKey || 'n';
    const c = (this.cache ||= {})[key] ||= { version: -1 };
    if (c.version !== this.grid.version) {
      const matrix = g.toMatrix();
      const base = (c.base = new this.PF.Grid(g.cols, g.rows, matrix));
      const touched = (c.touched = []);
      const at = base.getNodeAt, near = base.getNeighbors;
      base.getNodeAt = function (...a) { const n = at.apply(this, a); touched.push(n); return n; };
      base.getNeighbors = function (...a) { const ns = near.apply(this, a); for (const n of ns) touched.push(n); return ns; };
      c.walk = Uint8Array.from(matrix.flat(), (v) => (v ? 0 : 1)); // for clear()
      c.version = this.grid.version;
    }
    for (const n of c.touched) n.opened = n.closed = n.parent = n.g = n.h = n.f = undefined;
    c.touched.length = 0;
    this.walk = c.walk;
    return c.base;
  }

  // The grid as seen from a mirrored frame (same interface as Grid for reads):
  // mx flips x (east half), my flips y (south half, mirrorY maps only).
  mirrorView(mx = true, my = false) {
    const grid = this.grid, key = `${mx ? 'm' : ''}${my ? 's' : ''}` || 'n';
    const views = (this.views ||= {});
    if (views[key]) return views[key];
    const fx = (tx) => (mx ? grid.cols - 1 - tx : tx), fy = (ty) => (my ? grid.rows - 1 - ty : ty);
    const view = Object.create(grid); // inherits tile, rows, cols, tileOf, center, spiral...
    view.mirrored = mx;
    view.frameKey = key;
    view.mirrorY = false; // inside the frame, the north-half order applies
    view.isWalkable = (tx, ty) => grid.isWalkable(fx(tx), fy(ty));
    view.toMatrix = () => {
      const m = grid.toMatrix().map((row) => (mx ? row.slice().reverse() : row.slice()));
      return my ? m.reverse() : m;
    };
    view.nearestWalkable = function (tx, ty, maxR) { for (const t of this.spiral(tx, ty, maxR)) return t; return null; };
    views[key] = view;
    return view;
  }

  // Nearest tile to (gx,gy) that is reachable from (sx,sy), via flood fill.
  nearestReachable(sx, sy, gx, gy) {
    const g = this.frame, seen = new Uint8Array(g.cols * g.rows);
    const dir = sx < g.cols / 2 ? 1 : -1; // Phase 1 order in the west half, mirrored in the east
    const queue = [[sx, sy]];
    seen[g.idx(sx, sy)] = 1;
    let best = null, bestD = Infinity;
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      const d = (x - gx) ** 2 + (y - gy) ** 2;
      if (d < bestD) { bestD = d; best = { tx: x, ty: y }; }
      for (const [dx, dy] of [[dir, 0], [-dir, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (g.isWalkable(nx, ny) && !seen[g.idx(nx, ny)]) {
          seen[g.idx(nx, ny)] = 1;
          queue.push([nx, ny]);
        }
      }
    }
    return best;
  }

  // True if a band CLEARANCE px either side of the segment between two tile
  // centers is walkable. Wider than a plain line-of-sight check, so smoothed
  // paths keep units off rock corners instead of funnelling them along walls.
  // (Phase 12: reads the frame's walkability from the array pfGrid() keeps,
  // the same tiles as tileOf + isWalkable without an object per sample.)
  clear(a, b) {
    const g = this.frame, T = g.tile, CLEARANCE = 12, cols = g.cols, rows = g.rows, walk = this.walk;
    const ax = (a[0] + 0.5) * T, ay = (a[1] + 0.5) * T, bx = (b[0] + 0.5) * T, by = (b[1] + 0.5) * T;
    const len = Math.hypot(bx - ax, by - ay);
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    for (let d = 0; d <= len; d += 8) {
      const px = ax + ((bx - ax) * d) / len, py = ay + ((by - ay) * d) / len;
      for (let k = -1; k <= 1; k++) {
        const o = k * CLEARANCE;
        const tx = Math.floor((px + nx * o) / T), ty = Math.floor((py + ny * o) / T);
        if (tx < 0 || ty < 0 || tx >= cols || ty >= rows || !walk[ty * cols + tx]) return false;
      }
    }
    return true;
  }

  // Greedy string-pulling over the A* tile path using the clearance check.
  smooth(raw) {
    if (raw.length <= 2) return raw;
    const out = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !this.clear(raw[i], raw[j])) j--;
      out.push(raw[j]);
      i = j;
    }
    return out;
  }

  // Waypoints in px from (x,y) toward (tx,ty). Blocked or unreachable goals resolve
  // to the nearest reachable tile. Returns null if the unit itself is boxed in.
  find(x, y, tx, ty) {
    const grid = this.grid, W = grid.cols * grid.tile, H = grid.rows * grid.tile;
    const start = grid.tileOf(x, y);
    const east = start.tx >= grid.cols / 2, south = !!grid.mirrorY && start.ty >= grid.rows / 2;
    // Inside a planning frame every tie-break uses the canonical (north-west)
    // order; on a map mirrored north-south the unmirrored frame is a view too,
    // so the grid's own south-half spiral order doesn't leak in.
    if (!east && !south) { this.frame = grid.mirrorY ? this.mirrorView(false, false) : grid; return this.findInFrame(x, y, tx, ty); }
    this.frame = this.mirrorView(east, south);
    const fx = (v) => (east ? W - v : v), fy = (v) => (south ? H - v : v);
    const pts = this.findInFrame(fx(x), fy(y), fx(tx), fy(ty));
    return pts && pts.map((p) => ({ x: fx(p.x), y: fy(p.y) }));
  }

  findInFrame(x, y, tx, ty) {
    const g = this.frame;
    let s = g.tileOf(x, y);
    if (!g.isWalkable(s.tx, s.ty)) s = g.nearestWalkable(s.tx, s.ty, 3);
    if (!s) return null;
    const goalTile = g.tileOf(tx, ty);
    let goal = { tx: Math.min(Math.max(goalTile.tx, 0), g.cols - 1), ty: Math.min(Math.max(goalTile.ty, 0), g.rows - 1) };
    let exact = goal.tx === goalTile.tx && goal.ty === goalTile.ty && g.isWalkable(goal.tx, goal.ty);
    if (!g.isWalkable(goal.tx, goal.ty)) goal = g.nearestWalkable(goal.tx, goal.ty, 12) || goal;

    this.searches++;
    let raw = this.finder.findPath(s.tx, s.ty, goal.tx, goal.ty, this.pfGrid());
    if (raw.length === 0) {
      exact = false;
      goal = this.nearestReachable(s.tx, s.ty, goalTile.tx, goalTile.ty);
      if (!goal) return null;
      raw = this.finder.findPath(s.tx, s.ty, goal.tx, goal.ty, this.pfGrid());
      if (raw.length === 0) return [];
    }
    const pts = this.smooth(raw).slice(1).map(([cx, cy]) => g.center(cx, cy));
    if (exact) {
      if (pts.length) pts[pts.length - 1] = { x: tx, y: ty };
      else pts.push({ x: tx, y: ty });
    }
    return pts;
  }
}
