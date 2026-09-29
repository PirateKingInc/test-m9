// Child process for tools/ffa-balance.mjs: plays the jobs it is sent.
import { playFfa } from './ffa-lib.mjs';

process.on('message', ({ jobs }) => {
  for (const j of jobs) process.send({ result: playFfa(j) });
  process.send({ done: true });
});
