/**
 * Writes the token block into src/app/globals.css.
 *
 * Keeps one source of truth: the tokens are defined in TypeScript, verified there by
 * scripts/verify-design.ts, and emitted here. Hand-editing the CSS block is what would let the
 * stylesheet drift away from the palette that was actually checked.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { toCssVariables } from '../src/lib/design/tokens.js';

const TARGET = 'src/app/globals.css';
const START = '/* tokens:start */';
const END = '/* tokens:end */';

const css = readFileSync(TARGET, 'utf8');
const start = css.indexOf(START);
const end = css.indexOf(END);

if (start === -1 || end === -1) {
  console.error(`${TARGET} is missing the ${START} / ${END} markers.`);
  process.exitCode = 1;
} else {
  const block = `${START}\n:root {\n${toCssVariables()}\n}\n`;
  const updated = `${css.slice(0, start)}${block}${css.slice(end)}`;
  writeFileSync(TARGET, updated, 'utf8');
  console.log(`Wrote ${toCssVariables().split('\n').length} custom properties into ${TARGET}.`);
}
