// Camera zoom range (Phase 5), shared by pinch (touch) and the mouse wheel
// (desktop). The minimum was measured so a fully built home base fits the free
// screen area of a phone in landscape: see PHASE5_SPEC.md "Zoom range".
export const ZOOM = { min: 0.35, max: 1.6 };

// A fully built home base (buildings plus the home gold mines), world px: the
// largest box any AI strategy built in 600 s on Hard (seeds 1-3), and the
// margin kept around it on screen. test/footprint.test.js re-measures it.
export const BASE_FOOTPRINT = { w: 832, h: 704, margin: 32 };

export const clampZoom = (z) => Math.min(ZOOM.max, Math.max(ZOOM.min, z));

// Zoom to z, keeping the world point under screen point (sx, sy) fixed.
export function zoomAbout(cam, sx, sy, z) {
  const before = cam.getWorldPoint(sx, sy);
  cam.setZoom(clampZoom(z));
  cam.preRender(); // refresh the camera matrix so the world point below is current
  const after = cam.getWorldPoint(sx, sy);
  cam.scrollX += before.x - after.x;
  cam.scrollY += before.y - after.y;
}

// Screen px the HUD covers at each map edge; the camera may scroll that far
// past the map so its edges can be brought out from under the HUD. These are
// the fallbacks; the game measures the real HUD (hudInsets) because it differs
// by orientation: in portrait the row of group slots sits 154 px above the
// bottom, not 104, and a fixed margin left the map's bottom edge under it.
export const HUD_MARGIN = { top: 28, bottom: 104, right: 0, touchRight: 128 };
export const BAR_GAP = 8;

// The screen px the HUD covers on each side, measured from the page: the top
// bar, the bottom panel and the group slots above it, and the touch action bar
// on the right. Elements that are hidden or absent count as 0.
export function hudInsets(doc = document, touch = false) {
  const W = doc.documentElement.clientWidth, H = doc.documentElement.clientHeight;
  const rect = (id) => { const e = doc.getElementById(id); if (!e || e.hidden || e.offsetParent === null) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? r : null; };
  const top = rect('hud-top'), bottom = rect('hud-bottom'), groups = rect('groups'), bar = touch ? rect('touchbar') : null;
  const bottomEdge = Math.min(bottom ? bottom.top : H, groups ? groups.top : H);
  return {
    top: top ? Math.max(0, top.bottom) : HUD_MARGIN.top,
    bottom: bottom || groups ? Math.max(0, H - bottomEdge) : HUD_MARGIN.bottom,
    left: 0,
    // (The action bar floats 8 px in from the screen edge; the map may come
    // the same 8 px clear of it, so a base at the east edge fits beside it.)
    right: bar ? Math.max(0, W - bar.left + BAR_GAP) : touch ? HUD_MARGIN.touchRight : HUD_MARGIN.right,
  };
}

// Camera bounds (world px: x, y, width, height) for a map of mapW x mapH seen
// at `zoom` on a view of viewW x viewH screen px, with the HUD covering
// `insets` screen px on each side. Two rules, on each axis separately:
// - the camera may scroll until any map edge sits just clear of the HUD on
//   that side (the insets are screen px, so they grow in world px as the
//   camera zooms out);
// - where the whole map and its margins fit on screen at once (zoomed far out
//   on a small map, or a tall portrait screen), the bounds grow to the view,
//   centred on the map: the map sits in the middle of the free area instead of
//   being pinned to one side, and there is nothing to pan to on that axis.
export function hudBounds(zoom, mapW, mapH, insets, viewW, viewH) {
  const axis = (lo, size, hi, view) => {
    let a = -lo / zoom, len = size + (lo + hi) / zoom;
    const v = view / zoom;
    if (len < v) { a -= (v - len) / 2; len = v; }
    return [a, len];
  };
  const [x, w] = axis(insets.left, mapW, insets.right, viewW);
  const [y, h] = axis(insets.top, mapH, insets.bottom, viewH);
  return [x, y, w, h];
}

// Mouse wheel: one notch (deltaY ~100) zooms by about 16%.
export const wheelZoom = (zoom, deltaY) => zoom * Math.exp(-deltaY * 0.0015);
