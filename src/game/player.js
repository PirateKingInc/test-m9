// The local player's camp (Phase 11). Single-player is always camp 1 (the
// sim's PLAYER); in a multiplayer free-for-all, slot n plays camp n, so the
// multiplayer layer sets it before the game starts. An ES module live binding:
// every importer sees the change.
import { PLAYER as SIM_PLAYER } from '../sim/constants.js';

export let PLAYER = SIM_PLAYER;
export function setPlayer(team) { PLAYER = team; }
