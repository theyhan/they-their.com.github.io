/**
 * Contrast and legibility checks.
 *
 * The specification requires that change is never communicated by colour alone and that core
 * dashboards stay usable on mobile. Neither is verifiable by looking at a screenshot, so the parts
 * that can be computed are computed: WCAG 2.1 contrast ratios for every colour pair the UI renders,
 * and a floor on text size.
 *
 * Run with `bun scripts/verify-design.ts`.
 */

import { readFileSync } from 'node:fs';
import {
  checkAllPairs,
  contrastRatio,
  CONTRAST_PAIRS,
  LABEL_BADGE,
  MIN_BODY_TEXT_PX,
  parseHex,
  relativeLuminance,
  toCssVariables,
  TYPE,
} from '../src/lib/design/tokens.js';
import { check, expect, report } from './harness.js';

// ---------------------------------------------------------------------------
// The maths itself, against known values
// ---------------------------------------------------------------------------

check('contrast maths matches known WCAG values', () => {
  // Black on white is the defined maximum, 21:1.
  expect(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01, 'black on white must be 21:1');
  // Identical colours are 1:1.
  expect(Math.abs(contrastRatio('#4a5769', '#4a5769') - 1) < 0.001, 'a colour against itself must be 1:1');
  // Order must not matter.
  expect(
    Math.abs(contrastRatio('#0a539b', '#ffffff') - contrastRatio('#ffffff', '#0a539b')) < 0.001,
    'contrast must be symmetric',
  );
  // Mid grey #767676 on white is the canonical 4.54:1 boundary case.
  const boundary = contrastRatio('#767676', '#ffffff');
  expect(boundary > 4.5 && boundary < 4.6, `#767676 on white should be ~4.54, got ${boundary}`);
});

check('luminance is ordered and bounded', () => {
  expect(relativeLuminance('#000000') === 0, 'black luminance must be 0');
  expect(Math.abs(relativeLuminance('#ffffff') - 1) < 0.0001, 'white luminance must be 1');
  expect(relativeLuminance('#0f1729') < relativeLuminance('#4a5769'), 'darker ink must have lower luminance');
});

check('malformed colour tokens are rejected', () => {
  // A typo that parsed as black would contrast with everything and pass every check silently.
  let threw = false;
  try {
    parseHex('#8c1navigator');
  } catch {
    threw = true;
  }
  expect(threw, 'an invalid hex value must throw rather than default');

  for (const bad of ['#fff', 'red', '', '#12345g']) {
    let rejected = false;
    try {
      parseHex(bad);
    } catch {
      rejected = true;
    }
    expect(rejected, `${bad || '(empty)'} should be rejected`);
  }
});

// ---------------------------------------------------------------------------
// Every pair the UI renders
// ---------------------------------------------------------------------------

const results = checkAllPairs();

check('every registered colour pair meets its WCAG minimum', () => {
  const failures = results.filter((result) => !result.passes);
  const detail = failures
    .map((f) => `${f.pair.usage}: ${f.ratio}:1, needs ${f.required}:1 (${f.pair.fg} on ${f.pair.bg})`)
    .join('; ');
  expect(failures.length === 0, `${failures.length} pair(s) below minimum - ${detail}`);
});

check('body text pairs clear the 4.5:1 minimum', () => {
  const body = results.filter((result) => result.pair.kind === 'BODY');
  expect(body.length >= 20, `expected the full palette to be registered, got ${body.length} body pairs`);
  for (const result of body) {
    expect(result.ratio >= 4.5, `${result.pair.usage} is ${result.ratio}:1`);
  }
});

check('borders and focus rings clear the 3:1 non-text minimum', () => {
  const nonText = results.filter((result) => result.pair.kind === 'NON_TEXT');
  expect(nonText.length >= 5, 'borders and focus rings must be registered');
  for (const result of nonText) {
    expect(result.ratio >= 3, `${result.pair.usage} is ${result.ratio}:1`);
  }
});

check('the four provenance badges are mutually distinguishable', () => {
  // Spec 3.3 needs four visually distinct labels. If two badge backgrounds are nearly identical, the
  // distinction collapses for everyone, not only for colour-blind users.
  const badges = Object.entries(LABEL_BADGE);
  for (let i = 0; i < badges.length; i += 1) {
    for (let j = i + 1; j < badges.length; j += 1) {
      const [nameA, a] = badges[i]!;
      const [nameB, b] = badges[j]!;
      const separation = Math.abs(relativeLuminance(a.bg) - relativeLuminance(b.bg));
      const hueDiffers = a.bg !== b.bg;
      expect(hueDiffers, `${nameA} and ${nameB} share a background`);
      // Luminance alone need not differ much, since each badge also carries distinct text, but
      // identical luminance and near-identical hue would be indistinguishable in greyscale.
      const bothLight = relativeLuminance(a.bg) > 0.7 && relativeLuminance(b.bg) > 0.7;
      expect(bothLight || separation > 0.02, `${nameA} and ${nameB} are too close in luminance`);
    }
  }
});

// ---------------------------------------------------------------------------
// Type scale
// ---------------------------------------------------------------------------

check('no text style falls below the legibility floor', () => {
  const styles: Array<[string, number]> = [
    ['body', TYPE.body],
    ['small', TYPE.small],
    ['h3', TYPE.h3],
    ['h2', TYPE.h2],
    ['h1', TYPE.h1],
    ['display', TYPE.display],
  ];
  for (const [name, size] of styles) {
    expect(size >= MIN_BODY_TEXT_PX, `${name} is ${size}px, below the ${MIN_BODY_TEXT_PX}px floor`);
  }
  // micro is the one permitted exception, for uppercase badge text with letter spacing.
  expect(TYPE.micro >= 12, `micro is ${TYPE.micro}px, too small even for badge text`);
  expect(TYPE.micro < MIN_BODY_TEXT_PX, 'micro should be the only style below the floor');
});

check('the type scale increases monotonically', () => {
  const ordered = [TYPE.micro, TYPE.small, TYPE.body, TYPE.h3, TYPE.h2, TYPE.h1, TYPE.display];
  for (let i = 1; i < ordered.length; i += 1) {
    expect(ordered[i]! >= ordered[i - 1]!, `type scale is not ordered at index ${i}`);
  }
  expect(TYPE.h3 >= TYPE.body, 'a heading must not be smaller than body text');
});

// ---------------------------------------------------------------------------
// CSS emission
// ---------------------------------------------------------------------------

check('CSS variables cover every token', () => {
  const css = toCssVariables();
  for (const name of ['--surface-page', '--text-primary', '--accent', '--line-focus', '--warn-bg', '--font-small']) {
    expect(css.includes(name), `${name} missing from the emitted CSS`);
  }
  for (const label of Object.keys(LABEL_BADGE)) {
    const slug = label.toLowerCase().replace(/_/g, '-');
    expect(css.includes(`--badge-${slug}-bg`), `badge ${label} missing from the emitted CSS`);
  }
  // Every emitted value must be a real colour or length, never `undefined`.
  expect(!css.includes('undefined'), 'a token emitted as undefined');
  const hexCount = (css.match(/#[0-9a-f]{6}/g) ?? []).length;
  expect(hexCount >= 30, `expected the full palette in CSS, found ${hexCount} colours`);
});

check('every pair in the registry is actually reachable in CSS', () => {
  // Guards against registering a pair for the checker while the stylesheet uses a different colour.
  const css = toCssVariables();
  const colours = new Set((css.match(/#[0-9a-f]{6}/g) ?? []).map((c) => c.toLowerCase()));
  for (const pair of CONTRAST_PAIRS) {
    expect(
      colours.has(pair.fg.toLowerCase()),
      `${pair.usage}: foreground ${pair.fg} is checked but not emitted as a token`,
    );
    expect(
      colours.has(pair.bg.toLowerCase()),
      `${pair.usage}: background ${pair.bg} is checked but not emitted as a token`,
    );
  }
});

check('the stylesheet matches the verified tokens', () => {
  // The palette is only verified if the palette on screen is the one that was checked. This compares
  // the generated block in globals.css against the token source, so drift is a failing check rather
  // than a slow divergence nobody notices.
  const css = readFileSync('src/app/globals.css', 'utf8');
  const start = css.indexOf('/* tokens:start */');
  const end = css.indexOf('/* tokens:end */');
  expect(start !== -1 && end !== -1, 'globals.css must contain the tokens:start and tokens:end markers');

  const block = css.slice(start, end);
  const expected = toCssVariables().split('\n');
  const missing = expected.filter((line) => !block.includes(line.trim()));
  expect(
    missing.length === 0,
    `globals.css is out of date with the tokens. Run 'npm run tokens:css'. Missing: ${missing.slice(0, 3).join(' ')}`,
  );
});

// Report the measured ratios, so the numbers are visible rather than merely asserted.
console.log('\nMeasured contrast ratios:');
for (const result of [...results].sort((a, b) => a.ratio - b.ratio)) {
  const mark = result.passes ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${result.ratio.toFixed(2)}:1  (needs ${result.required}) ${result.pair.usage}`);
}

await report('Contrast and type scale verified.');
