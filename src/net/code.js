// Match codes (PHASE10_SPEC.md "Match codes"): 6 characters from a 32-letter
// alphabet with no 0/O or 1/I, shown as ABC-DEF. The lockstep module's codes
// (platform/lockstep/browser/code.js) with Dragonmarch's settings.
import { createCodes } from '../../platform/lockstep/index.js';
import { LOBBY } from './config.js';

export const CODES = createCodes({ alphabet: LOBBY.alphabet, length: LOBBY.codeLength, nameMax: LOBBY.nameMax });
export const { newCode, formatCode, parseCode, parseName } = CODES;
