/**
 * Design tokens.
 *
 * Legibility is treated as a measurable property, not a matter of taste. Every foreground/background
 * pair declared here is checked against WCAG 2.1 contrast minima by `scripts/verify-design.ts`, so a
 * change that makes text harder to read fails the build rather than shipping.
 *
 * Two rules from the specification shape these tokens:
 *
 *   1. "Do not communicate positive or negative change through color alone." Colour here is always
 *      redundant with a glyph and a sentence, so the palette carries emphasis, never meaning.
 *   2. Metric provenance labels (spec 3.3) need four visually distinct badges that all stay legible,
 *      which is why each badge declares its own text colour rather than inheriting one.
 *
 * Minimum body text size is 14px. The first draft of this UI used 12px for footnotes and tooltips,
 * which is the single most common legibility defect in dense dashboards.
 */

export interface ColorPair {
  readonly fg: string;
  readonly bg: string;
  /** What this pair is for, quoted in check failures. */
  readonly usage: string;
  /** 'BODY' requires 4.5:1, 'LARGE' 3:1 (>=18.66px bold or >=24px), 'NON_TEXT' 3:1. */
  readonly kind: 'BODY' | 'LARGE' | 'NON_TEXT';
}

export const SURFACE = {
  page: '#f4f6fa',
  card: '#ffffff',
  sunken: '#e9eef5',
  inverse: '#111a2b',
} as const;

export const TEXT = {
  /** Headings and figures. */
  primary: '#0f1729',
  /** Body copy and labels. */
  secondary: '#2c3849',
  /** Supporting copy. Deliberately darker than a conventional "muted" grey to hold 4.5:1. */
  muted: '#4a5769',
  onInverse: '#f7f9fc',
  onAccent: '#ffffff',
} as const;

/**
 * Borders are darker than a conventional dashboard palette on purpose.
 *
 * WCAG 1.4.11 arguably exempts a purely decorative divider, but a card outline delineates a component
 * and a table rule separates one post's numbers from another's, so both are treated as meaningful and
 * held to 3:1. The first draft used #b9c4d4, which measured 1.76:1 against a card - visible on a good
 * monitor, invisible on a laptop in daylight. Kept to 1px so the weight stays quiet.
 */
export const LINE = {
  /** Card and table borders. 3.38:1 on card, 3.12:1 on page. */
  default: '#808d9e',
  strong: '#5b6879',
  focus: '#0a539b',
} as const;

export const ACCENT = {
  /** Links, primary buttons, chart lines. */
  default: '#0a539b',
  hover: '#083f78',
  subtleBg: '#e8f0fa',
  subtleText: '#083f78',
} as const;

/**
 * Sentiment colours. Applied only on top of a glyph and a sentence that already carry the meaning,
 * so a user who cannot distinguish these loses nothing.
 */
export const SENTIMENT = {
  positiveText: '#0b5133',
  positiveBg: '#e3f3ea',
  negativeText: '#8c1c2b',
  negativeBg: '#fbe9ec',
  neutralText: '#3f4a5c',
  neutralBg: '#eceff4',
} as const;

/**
 * Notice panels. The border reuses the text colour, which already clears 4.5:1 against the panel
 * background, so the outline cannot be the weak part of a panel that exists to be noticed.
 */
export const NOTICE = {
  warnText: '#6b3a05',
  warnBg: '#fdf3e2',
  warnLine: '#6b3a05',
  infoText: '#0c4a6e',
  infoBg: '#e6f3fa',
  infoLine: '#0c4a6e',
} as const;

/**
 * Spec 3.3 provenance badges. Four distinct hues, each with its own legible text colour, and a border
 * that reuses that text colour on the same reasoning as the notice panels above.
 */
export const LABEL_BADGE = {
  RAW_API_METRIC: { bg: '#eaeef4', text: '#26313f', line: '#26313f' },
  CALCULATED: { bg: '#e6f0fb', text: '#0a4a86', line: '#0a4a86' },
  ESTIMATE: { bg: '#fdf1e0', text: '#6b3a05', line: '#6b3a05' },
  AI_INTERPRETATION: { bg: '#f0eafb', text: '#4b2382', line: '#4b2382' },
} as const;

/** Minimum 14px. Values are px; the stylesheet converts to rem where it matters. */
export const TYPE = {
  display: 30,
  h1: 24,
  h2: 19,
  h3: 16,
  body: 16,
  /** Footnotes, captions, badge text. Never smaller than this. */
  small: 14,
  /** Absolute floor, permitted only for the uppercase badge text where tracking compensates. */
  micro: 12.5,
} as const;

export const MIN_BODY_TEXT_PX = 14;

/**
 * Every pair the UI actually renders. The checker walks this list, so adding a colour combination to
 * a component without registering it here is a review problem rather than a silent regression.
 */
export const CONTRAST_PAIRS: readonly ColorPair[] = [
  { fg: TEXT.primary, bg: SURFACE.card, usage: 'headings and figures on a card', kind: 'BODY' },
  { fg: TEXT.primary, bg: SURFACE.page, usage: 'headings on the page background', kind: 'BODY' },
  { fg: TEXT.secondary, bg: SURFACE.card, usage: 'body copy on a card', kind: 'BODY' },
  { fg: TEXT.secondary, bg: SURFACE.page, usage: 'body copy on the page background', kind: 'BODY' },
  { fg: TEXT.muted, bg: SURFACE.card, usage: 'footnotes and tooltips on a card', kind: 'BODY' },
  { fg: TEXT.muted, bg: SURFACE.page, usage: 'footnotes on the page background', kind: 'BODY' },
  { fg: TEXT.muted, bg: SURFACE.sunken, usage: 'footnotes on a sunken panel', kind: 'BODY' },
  { fg: TEXT.onInverse, bg: SURFACE.inverse, usage: 'text on the inverse surface', kind: 'BODY' },
  { fg: TEXT.onAccent, bg: ACCENT.default, usage: 'primary button label', kind: 'BODY' },
  { fg: ACCENT.default, bg: SURFACE.card, usage: 'links on a card', kind: 'BODY' },
  { fg: ACCENT.default, bg: SURFACE.page, usage: 'links on the page background', kind: 'BODY' },
  { fg: ACCENT.subtleText, bg: ACCENT.subtleBg, usage: 'accent chip', kind: 'BODY' },
  { fg: SENTIMENT.positiveText, bg: SURFACE.card, usage: 'positive change text', kind: 'BODY' },
  { fg: SENTIMENT.negativeText, bg: SURFACE.card, usage: 'negative change text', kind: 'BODY' },
  { fg: SENTIMENT.neutralText, bg: SURFACE.card, usage: 'neutral change text', kind: 'BODY' },
  { fg: SENTIMENT.positiveText, bg: SENTIMENT.positiveBg, usage: 'positive chip', kind: 'BODY' },
  { fg: SENTIMENT.negativeText, bg: SENTIMENT.negativeBg, usage: 'negative chip', kind: 'BODY' },
  { fg: NOTICE.warnText, bg: NOTICE.warnBg, usage: 'demo and caveat banner', kind: 'BODY' },
  { fg: NOTICE.infoText, bg: NOTICE.infoBg, usage: 'informational panel', kind: 'BODY' },
  { fg: LABEL_BADGE.RAW_API_METRIC.text, bg: LABEL_BADGE.RAW_API_METRIC.bg, usage: 'badge: from platform', kind: 'BODY' },
  { fg: LABEL_BADGE.CALCULATED.text, bg: LABEL_BADGE.CALCULATED.bg, usage: 'badge: calculated', kind: 'BODY' },
  { fg: LABEL_BADGE.ESTIMATE.text, bg: LABEL_BADGE.ESTIMATE.bg, usage: 'badge: estimate', kind: 'BODY' },
  { fg: LABEL_BADGE.AI_INTERPRETATION.text, bg: LABEL_BADGE.AI_INTERPRETATION.bg, usage: 'badge: AI interpretation', kind: 'BODY' },
  // Non-text contrast (WCAG 1.4.11): borders and focus rings must be perceivable too.
  { fg: LINE.default, bg: SURFACE.card, usage: 'card and table borders', kind: 'NON_TEXT' },
  { fg: LINE.default, bg: SURFACE.page, usage: 'borders against the page', kind: 'NON_TEXT' },
  { fg: LINE.focus, bg: SURFACE.card, usage: 'focus ring on a card', kind: 'NON_TEXT' },
  { fg: LINE.focus, bg: SURFACE.page, usage: 'focus ring on the page', kind: 'NON_TEXT' },
  { fg: ACCENT.default, bg: SURFACE.card, usage: 'chart line against a card', kind: 'NON_TEXT' },
  { fg: LABEL_BADGE.ESTIMATE.line, bg: LABEL_BADGE.ESTIMATE.bg, usage: 'badge border: estimate', kind: 'NON_TEXT' },
  { fg: NOTICE.warnLine, bg: NOTICE.warnBg, usage: 'banner border', kind: 'NON_TEXT' },
];

// ---------------------------------------------------------------------------
// WCAG 2.1 contrast
// ---------------------------------------------------------------------------

export function parseHex(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    // A malformed token would otherwise silently pass as black, which contrasts with everything.
    throw new Error(`Invalid hex colour: ${hex}`);
  }
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio, 1 to 21. */
export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function requiredRatio(kind: ColorPair['kind']): number {
  return kind === 'BODY' ? 4.5 : 3;
}

export interface ContrastResult {
  pair: ColorPair;
  ratio: number;
  required: number;
  passes: boolean;
}

export function checkAllPairs(): ContrastResult[] {
  return CONTRAST_PAIRS.map((pair) => {
    const ratio = Math.round(contrastRatio(pair.fg, pair.bg) * 100) / 100;
    const required = requiredRatio(pair.kind);
    return { pair, ratio, required, passes: ratio >= required };
  });
}

/**
 * Emits the tokens as CSS custom properties, so the React stylesheet and the static preview renderer
 * share one source. Two stylesheets drifting apart is how a verified palette stops being the one on
 * screen.
 */
export function toCssVariables(): string {
  const entries: Array<[string, string]> = [
    ['--surface-page', SURFACE.page],
    ['--surface-card', SURFACE.card],
    ['--surface-sunken', SURFACE.sunken],
    ['--surface-inverse', SURFACE.inverse],
    ['--text-primary', TEXT.primary],
    ['--text-secondary', TEXT.secondary],
    ['--text-muted', TEXT.muted],
    ['--text-on-inverse', TEXT.onInverse],
    ['--text-on-accent', TEXT.onAccent],
    ['--line-default', LINE.default],
    ['--line-strong', LINE.strong],
    ['--line-focus', LINE.focus],
    ['--accent', ACCENT.default],
    ['--accent-hover', ACCENT.hover],
    ['--accent-subtle-bg', ACCENT.subtleBg],
    ['--accent-subtle-text', ACCENT.subtleText],
    ['--positive-text', SENTIMENT.positiveText],
    ['--positive-bg', SENTIMENT.positiveBg],
    ['--negative-text', SENTIMENT.negativeText],
    ['--negative-bg', SENTIMENT.negativeBg],
    ['--neutral-text', SENTIMENT.neutralText],
    ['--neutral-bg', SENTIMENT.neutralBg],
    ['--warn-text', NOTICE.warnText],
    ['--warn-bg', NOTICE.warnBg],
    ['--warn-line', NOTICE.warnLine],
    ['--info-text', NOTICE.infoText],
    ['--info-bg', NOTICE.infoBg],
    ['--info-line', NOTICE.infoLine],
    ['--font-body', `${TYPE.body}px`],
    ['--font-small', `${TYPE.small}px`],
    ['--font-micro', `${TYPE.micro}px`],
  ];

  for (const [label, badge] of Object.entries(LABEL_BADGE)) {
    const slug = label.toLowerCase().replace(/_/g, '-');
    entries.push([`--badge-${slug}-bg`, badge.bg]);
    entries.push([`--badge-${slug}-text`, badge.text]);
    entries.push([`--badge-${slug}-line`, badge.line]);
  }

  return entries.map(([name, value]) => `  ${name}: ${value};`).join('\n');
}
