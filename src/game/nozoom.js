// Phase 6: the browser's own zoom gestures must never fire over the game.
// Rapid taps (training units, spawning) were read as a native double-tap-to-zoom
// on mobile browsers. The fix has three layers:
// - CSS: every element outside the canvas uses `touch-action: manipulation`
//   (pan and pinch still work, double-tap-to-zoom does not); the canvas keeps
//   `touch-action: none` and handles its own pinch (src/game/touch.js).
// - The viewport meta tag disallows page scaling (index.html).
// - iOS Safari ignores both for its own gestures, so its non-standard gesture
//   events and double-click zoom are cancelled here. The game's pinch runs on
//   pointer events, which these listeners do not touch.
export function blockNativeZoom(doc = document) {
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) doc.addEventListener(type, stop, { passive: false });
}
