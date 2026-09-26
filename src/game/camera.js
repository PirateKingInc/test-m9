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
// past the map so its edges can be brought out from under the HUD. Touch mode
// adds the action bar on the right.
export const HUD_MARGIN = { top: 28, bottom: 104, right: 0, touchRight: 128 };

// Camera bounds for the current zoom: the margins are screen px, so they grow
// in world px as the camera zooms out (at 1x they equal the Phase 4 bounds).
export function hudBounds(zoom, width, height, touch) {
  const right = touch ? HUD_MARGIN.touchRight : HUD_MARGIN.right;
  const top = HUD_MARGIN.top / zoom, bottom = HUD_MARGIN.bottom / zoom;
  return [0, -top, width + right / zoom, height + top + bottom];
}

// Mouse wheel: one notch (deltaY ~100) zooms by about 16%.
export const wheelZoom = (zoom, deltaY) => zoom * Math.exp(-deltaY * 0.0015);
