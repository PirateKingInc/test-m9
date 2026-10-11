// DragonMarch Lockstep: the public API. A game uses only what this file
// exports (README.md is the integration guide; PLATFORM_SPEC.md the design).
// Nothing here knows about any particular game.

// Determinism
export { sin, cos, atan, atan2, hypot, installDetMath, detMathInstalled } from './detmath.js';
export { GOLDEN as DETMATH_GOLDEN, detMathFingerprint } from './detmath-golden.js';
export { SeededRng } from './rng.js';
export { createCodec, hashText } from './codec.js';

// The engine
export { Lockstep, DEFAULT_DELAY } from './core.js';
export { Session, PROTOCOL_MESSAGES } from './session.js';
export { DEFAULT_TIMING } from './timing.js';
export { FakeNet } from './testing.js';

// The browser transport: Firebase signaling, WebRTC mesh, TURN relay fallback
export { connectFirebase, isDenied } from './browser/firebase.js';
export { createCodes, CODE_DEFAULTS } from './browser/code.js';
export { Lobby, LobbyError, LOBBY_DEFAULTS, lineupOf, playersIn, playersOf } from './browser/lobby.js';
export { presence } from './browser/presence.js';
export { IceServers } from './browser/ice.js';
export { Mesh, MESH_DEFAULTS } from './browser/mesh.js';
export { Links } from './browser/links.js';
export { startMatch, rejoinMatch, runMatch, matchStore, metronome } from './browser/match.js';
