/**
 * fingerprint.js — melodic similarity screening (SimilarityDetectionAdapter shim).
 *
 * IMPORTANT SCOPE NOTE: this is a *symbolic* fingerprint over the generated lead
 * melody (pitch-interval + rhythm-class n-grams). It is transposition invariant
 * and cheap, which makes it a good pre-flight gate, but it is NOT a substitute
 * for audio fingerprinting against a licensed reference catalogue. The reference
 * set below is public-domain traditional material used as a test fixture so the
 * quarantine path can be exercised in the prototype.
 */

export const DETECTOR_VERSION = 'symbolic-interval-ngram/0.3.0';

/** Public-domain melodies, as [interval sequence] in semitones. */
export const REFERENCE_MOTIFS = [
  {
    id: 'pd-twinkle',
    title: 'Twinkle, Twinkle, Little Star (traditional, public domain)',
    intervals: [0, 7, 0, 2, 0, -2, 0, -2, 0, -1, 0, -2, 0],
  },
  {
    id: 'pd-ode-to-joy',
    title: 'Ode to Joy (Beethoven, public domain)',
    intervals: [0, 1, 2, 0, -2, -1, 0, -2, -2, -1, 0, 1, 2, 0],
  },
  {
    id: 'pd-frere-jacques',
    title: 'Frère Jacques (traditional, public domain)',
    intervals: [2, 2, -4, 2, 2, -4, 2, 2, 1, -1, -2, -2],
  },
  {
    id: 'pd-good-morning-to-all',
    title: 'Good Morning to All (Hill, public domain)',
    intervals: [0, 2, -2, 5, -1, -6, 0, 2, -2, 7, -2, -9],
  },
  {
    id: 'pd-arirang',
    title: 'Arirang (Korean traditional, public domain)',
    intervals: [0, 3, 2, -2, -3, 0, 2, 3, -3, -2, -3, 0],
  },
];

const N = 5;

function ngrams(seq, n = N) {
  const out = new Set();
  for (let i = 0; i + n <= seq.length; i++) {
    out.add(seq.slice(i, i + n).join(','));
  }
  return out;
}

function intervalsFromNotes(notes) {
  const sorted = [...notes].sort((a, b) => a.t - b.t);
  const iv = [];
  for (let i = 1; i < sorted.length; i++) {
    iv.push(clampInterval(sorted[i].midi - sorted[i - 1].midi));
  }
  return iv;
}

function clampInterval(x) {
  return Math.max(-12, Math.min(12, x));
}

/** Extract the lead/vocal line across the whole score. */
export function leadLine(score) {
  const notes = [];
  for (const s of score.sections) {
    const track = s.tracks.vocal || s.tracks.lead || s.tracks.leadStrings;
    if (!track) continue;
    for (const n of track) notes.push({ t: s.startBeat + n.t, midi: n.midi, d: n.d });
  }
  return notes;
}

export function fingerprint(score) {
  const notes = leadLine(score);
  const intervals = intervalsFromNotes(notes);
  const rhythm = notes.map((n) => rhythmClass(n.d));
  return {
    detectorVersion: DETECTOR_VERSION,
    noteCount: notes.length,
    intervalNgrams: [...ngrams(intervals)],
    rhythmNgrams: [...ngrams(rhythm, 6)],
    intervals,
  };
}

function rhythmClass(beats) {
  if (beats <= 0.3) return 0;
  if (beats <= 0.6) return 1;
  if (beats <= 1.1) return 2;
  if (beats <= 2.1) return 3;
  return 4;
}

function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  return inter / (aSet.size + bSet.size - inter);
}

/** Longest common contiguous run of intervals — the strongest "copy" signal. */
function longestRun(a, b) {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let carry = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = carry + 1;
        if (prev[j] > best) best = prev[j];
      } else {
        prev[j] = 0;
      }
      carry = tmp;
    }
  }
  return best;
}

export const THRESHOLDS = { pass: 0.34, review: 0.58 };

/**
 * @returns {{score:number, decision:'pass'|'review'|'quarantine', matches:Array, detectorVersion:string, evidence:object}}
 */
export function similarityCheck(score, extraReferences = []) {
  const fp = fingerprint(score);
  const mine = new Set(fp.intervalNgrams);
  const matches = [];
  for (const ref of [...REFERENCE_MOTIFS, ...extraReferences]) {
    const refNg = ngrams(ref.intervals);
    const j = jaccard(mine, refNg);
    const run = longestRun(fp.intervals, ref.intervals);
    const runScore = Math.min(1, run / 8);
    const combined = +(j * 0.55 + runScore * 0.45).toFixed(4);
    matches.push({ id: ref.id, title: ref.title, jaccard: +j.toFixed(4), longestRun: run, score: combined });
  }
  matches.sort((a, b) => b.score - a.score);
  const top = matches[0] || { score: 0 };
  const decision = top.score >= THRESHOLDS.review
    ? 'quarantine'
    : top.score >= THRESHOLDS.pass
      ? 'review'
      : 'pass';
  return {
    score: top.score,
    decision,
    matches: matches.slice(0, 3),
    detectorVersion: DETECTOR_VERSION,
    evidence: {
      noteCount: fp.noteCount,
      ngramSize: N,
      thresholds: THRESHOLDS,
      caveat: 'Symbolic melodic screen only. Production must add audio fingerprinting against a licensed catalogue.',
    },
  };
}
