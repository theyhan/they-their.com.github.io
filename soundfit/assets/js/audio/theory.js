/**
 * theory.js — pure music theory helpers.
 * No Web Audio dependency: safe to unit test in Node.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Deterministic PRNG. Same seed => same song. Required for reproducible A/B runs. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a — used for section cache keys, not for security. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function seedFrom(str) {
  return parseInt(hash32(str), 16) >>> 0;
}

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export const CHORD_QUALITIES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  min9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  add9: [0, 4, 7, 14],
  min6: [0, 3, 7, 9],
  dim: [0, 3, 6],
};

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteNameToMidi(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) throw new Error('bad note name: ' + name);
  return NOTE_NAMES.indexOf(m[1]) + (parseInt(m[2], 10) + 1) * 12;
}

export function midiToNoteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/**
 * Chord tones as absolute midi notes.
 * @param {number} tonicMidi root of the key, e.g. C3 = 48
 * @param {{root:number, quality:string}} chord root = semitones above tonic
 */
export function chordTones(tonicMidi, chord, octaveShift = 0) {
  const q = CHORD_QUALITIES[chord.quality] || CHORD_QUALITIES.maj;
  const base = tonicMidi + chord.root + octaveShift * 12;
  return q.map((iv) => base + iv);
}

/** Closest voicing of `tones` inside [lowMidi, highMidi], keeps root at bottom. */
export function voice(tones, lowMidi, highMidi) {
  const out = [];
  for (const t of tones) {
    let n = t;
    while (n < lowMidi) n += 12;
    while (n > highMidi) n -= 12;
    out.push(n);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/** Scale degrees of the key as absolute midi pitch classes, for melody constraint. */
export function scalePitches(tonicMidi, mode, fromMidi, toMidi) {
  const sc = SCALES[mode] || SCALES.major;
  const out = [];
  for (let m = fromMidi; m <= toMidi; m++) {
    const rel = ((m - tonicMidi) % 12 + 12) % 12;
    if (sc.includes(rel)) out.push(m);
  }
  return out;
}

/** Snap a midi note to the nearest pitch in the key. */
export function snapToScale(midi, tonicMidi, mode) {
  const sc = SCALES[mode] || SCALES.major;
  for (let d = 0; d < 7; d++) {
    for (const dir of [1, -1]) {
      const cand = midi + d * dir;
      const rel = ((cand - tonicMidi) % 12 + 12) % 12;
      if (sc.includes(rel)) return cand;
    }
  }
  return midi;
}

/**
 * Chord progressions per genre. Offsets are semitones above the tonic so the
 * same table works for major and minor keys.
 */
export const PROGRESSIONS = {
  acoustic_ballad: {
    mode: 'major',
    intro: [[0, 'add9'], [7, 'sus4'], [9, 'min7'], [5, 'maj']],
    verse: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']],
    prechorus: [[5, 'maj'], [7, 'maj'], [9, 'min7'], [7, 'sus4']],
    chorus: [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']],
    bridge: [[5, 'maj'], [0, 'maj'], [2, 'min7'], [7, 'maj']],
    solo: [[9, 'min7'], [5, 'maj9'], [0, 'maj'], [7, 'sus4']],
    outro: [[5, 'maj'], [0, 'add9']],
  },
  city_pop: {
    mode: 'major',
    intro: [[0, 'maj9'], [4, 'dom7'], [9, 'min7'], [7, 'dom7']],
    verse: [[0, 'maj7'], [9, 'min7'], [2, 'min7'], [7, 'dom7']],
    prechorus: [[5, 'maj7'], [7, 'dom7'], [9, 'min7'], [2, 'min7']],
    chorus: [[5, 'maj7'], [7, 'dom7'], [0, 'maj7'], [9, 'min7']],
    bridge: [[2, 'min9'], [7, 'dom7'], [0, 'maj9'], [5, 'maj7']],
    solo: [[0, 'maj9'], [9, 'min7'], [5, 'maj7'], [7, 'dom7']],
    outro: [[0, 'maj9'], [5, 'maj7']],
  },
  cinematic: {
    mode: 'minor',
    intro: [[0, 'min'], [8, 'maj'], [3, 'maj']],
    verse: [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']],
    prechorus: [[5, 'min'], [10, 'maj'], [8, 'maj'], [0, 'min']],
    chorus: [[8, 'maj'], [3, 'maj'], [0, 'min'], [10, 'maj']],
    bridge: [[5, 'min'], [0, 'min'], [8, 'maj'], [3, 'maj']],
    solo: [[0, 'min9'], [8, 'maj'], [10, 'maj'], [3, 'maj']],
    outro: [[0, 'min'], [8, 'maj']],
  },
  hiphop_soul: {
    mode: 'minor',
    intro: [[0, 'min9'], [5, 'min7']],
    verse: [[0, 'min9'], [5, 'min7'], [8, 'maj7'], [7, 'dom7']],
    prechorus: [[3, 'maj7'], [7, 'dom7'], [0, 'min9'], [5, 'min7']],
    chorus: [[8, 'maj7'], [7, 'dom7'], [0, 'min9'], [5, 'min7']],
    bridge: [[5, 'min7'], [10, 'maj'], [3, 'maj7'], [7, 'dom7']],
    solo: [[0, 'min9'], [8, 'maj7'], [5, 'min7'], [7, 'dom7']],
    outro: [[0, 'min9'], [5, 'min7']],
  },
  jazz_lounge: {
    mode: 'major',
    intro: [[2, 'min7'], [7, 'dom7'], [0, 'maj7'], [9, 'min7']],
    verse: [[0, 'maj7'], [9, 'min7'], [2, 'min7'], [7, 'dom7']],
    prechorus: [[2, 'min7'], [7, 'dom7'], [4, 'min7'], [9, 'dom7']],
    chorus: [[5, 'maj7'], [10, 'dom7'], [0, 'maj7'], [7, 'dom7']],
    bridge: [[9, 'min7'], [2, 'dom7'], [7, 'maj7'], [4, 'min7']],
    solo: [[0, 'maj7'], [9, 'min7'], [2, 'min7'], [7, 'dom7']],
    outro: [[2, 'min7'], [7, 'dom7'], [0, 'maj9']],
  },
  indie_folk: {
    mode: 'major',
    intro: [[0, 'sus2'], [9, 'min7'], [5, 'maj']],
    verse: [[0, 'maj'], [9, 'min'], [5, 'maj'], [0, 'maj']],
    prechorus: [[9, 'min'], [5, 'maj'], [7, 'sus4'], [7, 'maj']],
    chorus: [[5, 'maj'], [0, 'maj'], [7, 'maj'], [9, 'min']],
    bridge: [[2, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']],
    solo: [[0, 'add9'], [9, 'min7'], [5, 'maj'], [7, 'maj']],
    outro: [[5, 'maj'], [0, 'sus2']],
  },
};

export const GENRE_LABELS = {
  acoustic_ballad: { ko: '어쿠스틱 발라드', en: 'Acoustic Ballad' },
  city_pop: { ko: '시티팝', en: 'City Pop' },
  cinematic: { ko: '시네마틱', en: 'Cinematic' },
  hiphop_soul: { ko: '힙합 / 소울', en: 'Hip-hop / Soul' },
  jazz_lounge: { ko: '재즈 라운지', en: 'Jazz Lounge' },
  indie_folk: { ko: '인디 포크', en: 'Indie Folk' },
};

/** Chord list expanded across bars: 1 chord per bar unless progression is short. */
export function chordsForSection(genre, kind, bars, beatsPerBar) {
  const table = PROGRESSIONS[genre] || PROGRESSIONS.acoustic_ballad;
  const prog = table[kind] || table.verse;
  const out = [];
  for (let bar = 0; bar < bars; bar++) {
    const c = prog[bar % prog.length];
    out.push({
      root: c[0],
      quality: c[1],
      startBeat: bar * beatsPerBar,
      beats: beatsPerBar,
      bar,
    });
  }
  return out;
}
