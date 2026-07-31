/**
 * arranger.js — MusicSpec (+ approved lyrics) -> a deterministic note score.
 *
 * Pure JS: no Web Audio, no DOM. This is the "Music Director" output in the spec.
 * The renderer consumes this. Because it is pure and seeded, the same spec always
 * produces the same score, which is what makes A/B differences explainable and
 * section-level revision cacheable.
 */

import {
  mulberry32,
  hash32,
  seedFrom,
  chordsForSection,
  chordTones,
  voice,
  snapToScale,
  noteNameToMidi,
  PROGRESSIONS,
} from './theory.js';

const BEATS_PER_BAR = 4;

/** Relative loudness/orchestration weight per section kind. */
export const SECTION_INTENSITY = {
  intro: 0.45,
  verse: 0.68,
  prechorus: 0.84,
  chorus: 1.0,
  bridge: 0.6,
  solo: 0.9,
  outro: 0.45,
};

export const SECTION_LABELS = {
  intro: { ko: '인트로', en: 'Intro' },
  verse: { ko: '벌스', en: 'Verse' },
  prechorus: { ko: '프리코러스', en: 'Pre-chorus' },
  chorus: { ko: '후렴', en: 'Chorus' },
  bridge: { ko: '브릿지', en: 'Bridge' },
  solo: { ko: '연주 솔로', en: 'Solo' },
  outro: { ko: '아웃트로', en: 'Outro' },
};

const TEMPLATES = {
  compact: ['intro:2', 'verse:8', 'chorus:8', 'verse:8', 'chorus:8', 'outro:2'],
  standard: [
    'intro:4', 'verse:8', 'prechorus:4', 'chorus:8',
    'verse:8', 'prechorus:4', 'chorus:8', 'bridge:4', 'chorus:8', 'outro:4',
  ],
  standard_solo: [
    'intro:4', 'verse:8', 'prechorus:4', 'chorus:8',
    'verse:8', 'prechorus:4', 'chorus:8', 'solo:4', 'chorus:8', 'outro:4',
  ],
  extended: [
    'intro:4', 'verse:8', 'prechorus:4', 'chorus:8',
    'verse:8', 'prechorus:4', 'chorus:8', 'bridge:8', 'solo:4', 'chorus:8', 'outro:6',
  ],
};

/**
 * Choose a structure that lands closest to the requested duration.
 * Returns [{kind, bars}] plus the template id actually used.
 */
export function fitStructure(targetSeconds, bpm, opts = {}) {
  const barSeconds = (BEATS_PER_BAR * 60) / bpm;
  const wantSolo = !!opts.wantSolo;
  let best = null;
  for (const [id, tpl] of Object.entries(TEMPLATES)) {
    for (let introPad = 0; introPad <= 4; introPad += 2) {
      for (let outroPad = 0; outroPad <= 6; outroPad += 2) {
        const parts = tpl.map((s) => {
          const [kind, bars] = s.split(':');
          return { kind, bars: parseInt(bars, 10) };
        });
        parts[0].bars += introPad;
        parts[parts.length - 1].bars += outroPad;
        const bars = parts.reduce((a, p) => a + p.bars, 0);
        const dur = bars * barSeconds;
        let score = Math.abs(dur - targetSeconds);
        if (wantSolo && !tpl.some((s) => s.startsWith('solo'))) score += 12;
        if (!best || score < best.score) best = { score, parts, id };
      }
    }
  }
  return { parts: best.parts, templateId: best.id };
}

function registerFor(vocalType, character) {
  // Lead melody window. Instrumental still needs a lead line, so we default to female-ish.
  let center = 72; // C5
  if (vocalType === 'male') center = 60;
  else if (vocalType === 'duet') center = 66;
  else if (vocalType === 'instrumental') center = 69;
  if (character === 'low') center -= 3;
  if (character === 'airy' || character === 'clear') center += 2;
  return { low: center - 7, high: center + 9, center };
}

function rhythmCells(feel, rng) {
  if (feel === 'swing') return [[0.66, 0.34], [1], [0.5, 0.5], [0.66, 0.34]];
  if (feel === 'sixteenth') return [[0.5, 0.25, 0.25], [0.25, 0.25, 0.5], [0.5, 0.5], [1]];
  return [[1], [0.5, 0.5], [0.75, 0.25], [1.5, 0.5]];
}

/**
 * Distribute `syllables` notes across `beats` beats of a lyric line.
 * Always leaves breathing room at the end of the phrase.
 */
function phraseRhythm(syllables, beats, feel, rng) {
  const usable = Math.max(1, beats - Math.min(1.5, beats * 0.2));
  const cells = rhythmCells(feel, rng);
  const durs = [];
  let n = Math.max(1, syllables);
  while (durs.length < n) {
    const cell = cells[Math.floor(rng() * cells.length)];
    for (const d of cell) {
      if (durs.length < n) durs.push(d);
    }
  }
  const total = durs.reduce((a, b) => a + b, 0);
  const k = usable / total;
  let t = 0;
  const out = [];
  for (const d of durs) {
    const dur = d * k;
    out.push({ t, d: Math.max(0.12, dur * 0.92) });
    t += dur;
  }
  return out;
}

function melodyForPhrase(rhythm, chords, ctxTheory, rng, opts) {
  const { tonicMidi, mode } = ctxTheory;
  const { low, high } = opts.register;
  const notes = [];
  let cur = opts.startMidi;
  const contour = opts.contour || 0; // -1 falling, 0 arch, 1 rising
  rhythm.forEach((r, i) => {
    const chord = chordAt(chords, r.t);
    const tones = chordTones(tonicMidi, chord, 0).map((m) => {
      let n = m;
      while (n < low) n += 12;
      while (n > high) n -= 12;
      return n;
    });
    const strong = Math.abs(r.t % 1) < 0.01 && Math.floor(r.t) % 2 === 0;
    const progress = i / Math.max(1, rhythm.length - 1);
    let target;
    if (strong || i === rhythm.length - 1) {
      // resolve to a chord tone
      target = tones.reduce((bestN, n) => (Math.abs(n - cur) < Math.abs(bestN - cur) ? n : bestN), tones[0]);
    } else {
      const step = [-2, -1, 1, 2, 2, 3][Math.floor(rng() * 6)];
      target = snapToScale(cur + step, tonicMidi, mode);
    }
    // apply contour pull
    const pull = contour === 0 ? Math.sin(progress * Math.PI) * 3 : contour * progress * 4;
    target = snapToScale(Math.round(target + pull * (rng() < 0.5 ? 1 : 0)), tonicMidi, mode);
    if (target < low) target += 12;
    if (target > high) target -= 12;
    notes.push({ t: r.t, d: r.d, midi: target, vel: strong ? 0.95 : 0.78 });
    cur = target;
  });
  return notes;
}

function chordAt(chords, beat) {
  for (let i = chords.length - 1; i >= 0; i--) {
    if (beat >= chords[i].startBeat - 1e-6) return chords[i];
  }
  return chords[0];
}

/* ------------------------------------------------------------------ *
 * Track generators
 * ------------------------------------------------------------------ */

function bassTrack(chords, tonicMidi, genre, intensity, feel, rng) {
  const notes = [];
  for (const c of chords) {
    const root = tonicMidi + c.root - 24; // two octaves down
    let pattern;
    if (genre === 'hiphop_soul') pattern = [[0, 1.5], [1.5, 0.5], [2.5, 1.0]];
    else if (genre === 'city_pop') pattern = [[0, 0.75], [0.75, 0.75], [2, 0.5], [3, 0.5]];
    else if (genre === 'jazz_lounge') pattern = [[0, 1], [1, 1], [2, 1], [3, 1]];
    else if (feel === 'sixteenth') pattern = [[0, 1], [1.5, 0.5], [2, 1], [3.5, 0.5]];
    else pattern = [[0, 2], [2, 2]];
    pattern.forEach(([t, d], i) => {
      let midi = root;
      if (i > 0 && rng() < 0.28) midi = root + [7, 5, 12, 3][Math.floor(rng() * 4)];
      notes.push({ t: c.startBeat + t, d: d * 0.92, midi, vel: 0.7 + 0.25 * intensity });
    });
  }
  return notes;
}

function chordCompTrack(chords, tonicMidi, genre, intensity, feel, rng, spread) {
  const notes = [];
  for (const c of chords) {
    const tones = voice(chordTones(tonicMidi, c, 0), 52 + spread, 74 + spread);
    let hits;
    if (genre === 'hiphop_soul') hits = [[0, 2.2], [2.5, 1.4]];
    else if (genre === 'city_pop') hits = [[0.5, 0.4], [1.5, 0.4], [2.5, 0.4], [3.5, 0.4]];
    else if (genre === 'jazz_lounge') hits = [[0, 0.8], [1.66, 0.6], [3, 0.9]];
    else if (feel === 'swing') hits = [[0, 1.2], [1.66, 0.8], [2.66, 1.2]];
    else if (intensity > 0.9) hits = [[0, 1], [1, 1], [2, 1], [3, 1]];
    else hits = [[0, 2], [2, 2]];
    hits.forEach(([t, d], hi) => {
      tones.forEach((m, idx) => {
        notes.push({
          t: c.startBeat + t + idx * 0.008,
          d: d * 0.95,
          midi: m,
          vel: (hi === 0 ? 0.8 : 0.62) * (0.6 + 0.4 * intensity),
        });
      });
    });
  }
  return notes;
}

function arpTrack(chords, tonicMidi, intensity, rng) {
  const notes = [];
  for (const c of chords) {
    const tones = voice(chordTones(tonicMidi, c, 0), 64, 88);
    const seq = [...tones, ...tones.slice(0, -1).reverse()];
    const step = 0.5;
    for (let i = 0; i * step < c.beats; i++) {
      const midi = seq[i % seq.length];
      notes.push({ t: c.startBeat + i * step, d: step * 0.9, midi, vel: 0.4 + 0.3 * intensity });
    }
  }
  return notes;
}

function padTrack(chords, tonicMidi, intensity) {
  const notes = [];
  for (const c of chords) {
    const tones = voice(chordTones(tonicMidi, c, 0), 55, 79);
    for (const m of tones) {
      notes.push({ t: c.startBeat, d: c.beats * 0.99, midi: m, vel: 0.34 + 0.3 * intensity });
    }
  }
  return notes;
}

function drumTrack(bars, genre, intensity, feel, rng, isLast) {
  const notes = [];
  const kick = 36, snare = 38, hat = 42, openHat = 46, clap = 39, ride = 51;
  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * BEATS_PER_BAR;
    const fill = isLast && bar === bars - 1;
    if (genre === 'hiphop_soul') {
      [0, 0.75, 2.5].forEach((t) => notes.push({ t: b0 + t, d: 0.2, midi: kick, vel: 1 }));
      [1, 3].forEach((t) => notes.push({ t: b0 + t, d: 0.2, midi: snare, vel: 0.85 }));
      for (let i = 0; i < 8; i++) {
        if (rng() < 0.85) notes.push({ t: b0 + i * 0.5, d: 0.1, midi: hat, vel: i % 2 ? 0.4 : 0.6 });
      }
    } else if (genre === 'jazz_lounge') {
      for (let i = 0; i < 4; i++) {
        notes.push({ t: b0 + i, d: 0.2, midi: ride, vel: 0.45 });
        notes.push({ t: b0 + i + 0.66, d: 0.2, midi: ride, vel: 0.3 });
      }
      notes.push({ t: b0 + 1, d: 0.2, midi: snare, vel: 0.35 });
      notes.push({ t: b0 + 3, d: 0.2, midi: snare, vel: 0.4 });
    } else {
      notes.push({ t: b0, d: 0.2, midi: kick, vel: 1 });
      notes.push({ t: b0 + 2, d: 0.2, midi: kick, vel: 0.9 });
      if (intensity > 0.7) notes.push({ t: b0 + 2.75, d: 0.2, midi: kick, vel: 0.6 });
      notes.push({ t: b0 + 1, d: 0.2, midi: intensity > 0.9 ? clap : snare, vel: 0.8 });
      notes.push({ t: b0 + 3, d: 0.2, midi: intensity > 0.9 ? clap : snare, vel: 0.85 });
      const div = feel === 'sixteenth' && intensity > 0.8 ? 0.25 : 0.5;
      for (let t = 0; t < BEATS_PER_BAR; t += div) {
        notes.push({ t: b0 + t, d: 0.08, midi: t % 1 === 0 ? hat : hat, vel: t % 1 === 0 ? 0.5 : 0.3 });
      }
      if (bar % 4 === 3) notes.push({ t: b0 + 3.5, d: 0.3, midi: openHat, vel: 0.45 });
    }
    if (fill) {
      notes.push({ t: b0 + 3, d: 0.2, midi: snare, vel: 0.7 });
      notes.push({ t: b0 + 3.25, d: 0.2, midi: snare, vel: 0.8 });
      notes.push({ t: b0 + 3.5, d: 0.2, midi: snare, vel: 0.9 });
      notes.push({ t: b0 + 3.75, d: 0.2, midi: snare, vel: 1 });
    }
  }
  return notes;
}

/* ------------------------------------------------------------------ *
 * Main entry
 * ------------------------------------------------------------------ */

/**
 * @param {object} spec MusicSpec (see domain/spec.js)
 * @param {object} lyrics optional {sections:[{kind,index,lines:[{text,syllables,id}]}]}
 * @returns {object} score
 */
export function arrange(spec, lyrics) {
  const v = spec.variation || {};
  const bpm = Math.round((spec.tempo || 78) + (v.tempoDelta || 0));
  const genre = PROGRESSIONS[spec.genre] ? spec.genre : 'acoustic_ballad';
  const mode = spec.key?.mode || PROGRESSIONS[genre].mode;
  const tonicMidi = noteNameToMidi((spec.key?.tonic || 'C') + '3');
  const feel = v.rhythmFeel || 'straight';
  // Structure is chosen from the BASE tempo, not the variation-adjusted tempo, so
  // an A/B tempo axis cannot silently change the song form. Both variants keep
  // the same sections; only what the axes declare actually differs.
  const { parts, templateId } = fitStructure(spec.structure?.targetSeconds || 190, spec.tempo || 78, {
    wantSolo: !!spec.structure?.wantSolo,
  });
  const beatSeconds = 60 / bpm;
  const register = registerFor(spec.vocal?.type, spec.vocal?.character);

  const counters = {};
  const sections = [];
  let barCursor = 0;

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    counters[part.kind] = (counters[part.kind] || 0) + 1;
    const index = counters[part.kind];
    const id = `${part.kind}${index}`;
    const override = (spec.sectionOverrides && spec.sectionOverrides[id]) || {};
    const baseIntensity = SECTION_INTENSITY[part.kind] ?? 0.7;
    const intensity = clamp((override.intensity ?? 1) * baseIntensity, 0.15, 1.35);
    const chords = chordsForSection(genre, part.kind, part.bars, BEATS_PER_BAR);

    // Seeded per section so editing one section does not reshuffle the others.
    const rng = mulberry32(seedFrom(`${spec.seed}|${id}|${JSON.stringify(override)}`));

    const lyricSection = findLyricSection(lyrics, part.kind, index);
    const lines = lyricSection ? lyricSection.lines.filter((l) => l.text.trim()) : [];

    // ---- lead / vocal guide melody ----
    const leadNotes = [];
    const lineTimings = [];
    const isVocalSection = ['verse', 'prechorus', 'chorus', 'bridge'].includes(part.kind);
    if (isVocalSection && lines.length && !spec.instrumentalOnly) {
      const barsPerLine = Math.max(1, Math.floor(part.bars / lines.length));
      let cur = register.center;
      lines.forEach((line, li) => {
        const startBeat = Math.min(part.bars - barsPerLine, li * barsPerLine) * BEATS_PER_BAR;
        const beats = barsPerLine * BEATS_PER_BAR;
        const rhythm = phraseRhythm(line.syllables || countFallback(line.text), beats, feel, rng);
        const lift = part.kind === 'chorus' ? 4 + (v.chorusLift || 0) * 3 : 0;
        const notes = melodyForPhrase(
          rhythm.map((r) => ({ t: r.t + startBeat, d: r.d })),
          chords,
          { tonicMidi, mode },
          rng,
          {
            register: { low: register.low + lift, high: register.high + lift },
            startMidi: clamp(cur + lift, register.low, register.high + lift),
            contour: part.kind === 'chorus' ? 1 : li % 2 === 0 ? 0 : -1,
          },
        );
        notes.forEach((n, ni) => {
          n.syllable = ni;
          n.lineId = line.id;
          leadNotes.push(n);
        });
        if (notes.length) {
          cur = notes[notes.length - 1].midi;
          lineTimings.push({
            lineId: line.id,
            text: line.text,
            startBeat: notes[0].t,
            endBeat: notes[notes.length - 1].t + notes[notes.length - 1].d,
          });
        }
      });
    } else if (part.kind === 'solo' || part.kind === 'intro' || isVocalSection) {
      // instrumental mode, or a section with no lyrics yet: the lead instrument
      // carries the melody so the arrangement is still auditionable.
      const beats = part.bars * BEATS_PER_BAR;
      const noteCount = Math.max(4, Math.round(beats * (part.kind === 'solo' ? 1.4 : 0.6)));
      const rhythm = phraseRhythm(noteCount, beats, feel, rng);
      melodyForPhrase(rhythm, chords, { tonicMidi, mode }, rng, {
        register,
        startMidi: register.center,
        contour: part.kind === 'solo' ? 1 : 0,
      }).forEach((n) => leadNotes.push(n));
    }

    // ---- accompaniment ----
    const inst = spec.instruments || {};
    const density = v.arrangementDensity === 'full' ? 1 : 0.72;
    const tracks = {};
    const lead = v.leadInstrument || 'piano';

    if (gain(inst.piano)) {
      tracks.piano = chordCompTrack(chords, tonicMidi, genre, intensity, feel, rng, 0);
    }
    if (gain(inst.guitar)) {
      tracks.guitar = intensity > 0.75 || genre === 'indie_folk'
        ? arpTrack(chords, tonicMidi, intensity, rng)
        : chordCompTrack(chords, tonicMidi, genre, intensity * 0.9, feel, rng, 5);
    }
    if (gain(inst.strings) && intensity > 0.5) {
      tracks.strings = padTrack(chords, tonicMidi, intensity);
    }
    if (gain(inst.synth)) {
      tracks.synth = intensity > 0.8 ? arpTrack(chords, tonicMidi, intensity, rng) : padTrack(chords, tonicMidi, intensity);
    }
    if (gain(inst.brass) && intensity > 0.85) {
      tracks.brass = padTrack(chords, tonicMidi, intensity * 0.8).filter((n) => n.midi > 60);
    }
    if (gain(inst.bass) !== 0 && part.kind !== 'intro') {
      tracks.bass = bassTrack(chords, tonicMidi, genre, intensity, feel, rng);
    }
    const drumLevel = override.drums ?? inst.drums ?? 0.7;
    if (drumLevel > 0.02 && intensity > 0.5 && part.kind !== 'intro') {
      tracks.drums = drumTrack(part.bars, genre, intensity, feel, rng, pi === parts.length - 2);
    }
    if (leadNotes.length) {
      const useVocal = isVocalSection && lines.length && !spec.instrumentalOnly;
      tracks[useVocal ? 'vocal' : lead === 'strings' ? 'leadStrings' : 'lead'] = leadNotes;
    }

    // strip excluded instruments
    for (const ex of spec.exclusions || []) {
      if (tracks[ex]) delete tracks[ex];
    }

    const durationBeats = part.bars * BEATS_PER_BAR;
    const section = {
      id,
      kind: part.kind,
      index,
      bars: part.bars,
      startBeat: barCursor * BEATS_PER_BAR,
      durationBeats,
      startTime: barCursor * BEATS_PER_BAR * beatSeconds,
      duration: durationBeats * beatSeconds,
      intensity,
      chords,
      tracks,
      lineTimings,
      levels: {
        piano: lvl(inst.piano, density, intensity),
        guitar: lvl(inst.guitar, density, intensity),
        strings: lvl(inst.strings, density, intensity),
        synth: lvl(inst.synth, density, intensity),
        brass: lvl(inst.brass, density, intensity),
        bass: lvl(inst.bass ?? 0.85, 1, 1),
        drums: lvl(drumLevel, density, intensity),
        vocal: (override.vocalLevel ?? 1) * (spec.vocal?.level ?? 1),
        lead: 0.85,
        leadStrings: 0.8,
      },
      tone: {
        // "make the vocal warmer" maps to a real filter change, not a prompt string
        vocalWarmth: override.vocalWarmth ?? spec.vocal?.warmth ?? 0.5,
        brightness: override.brightness ?? (spec.mood === 'calm' ? 0.4 : 0.6),
      },
    };
    // per-section level overrides keep revisions local instead of global
    if (override.levels) Object.assign(section.levels, override.levels);
    section.cacheKey = sectionCacheKey(section, spec, bpm);
    sections.push(section);
    barCursor += part.bars;
  }

  const totalBeats = barCursor * BEATS_PER_BAR;
  return {
    bpm,
    beatSeconds,
    genre,
    mode,
    tonicMidi,
    key: `${spec.key?.tonic || 'C'} ${mode}`,
    templateId,
    sections,
    duration: totalBeats * beatSeconds,
    totalBars: barCursor,
    reverb: spec.mood === 'dramatic' || genre === 'cinematic' ? 0.42 : 0.26,
    instrumentalOnly: !!spec.instrumentalOnly,
    seed: spec.seed,
  };
}

/**
 * Content hash over everything that affects the rendered audio of THIS section,
 * including every note. Two scores can therefore be diffed to find the exact set
 * of sections that must be re-rendered — the cache can never go stale on a
 * change the listener would hear.
 */
function sectionCacheKey(section, spec, bpm) {
  const noteDigest = Object.keys(section.tracks)
    .sort()
    .map((name) => {
      const level = section.levels[name] ?? 0;
      const notes = section.tracks[name]
        .map((n) => `${n.t.toFixed(3)}:${n.d.toFixed(3)}:${n.midi}:${n.vel.toFixed(2)}:${n.syllable ?? ''}`)
        .join('|');
      return `${name}@${level.toFixed(4)}#${hash32(notes)}`;
    })
    .join(';');
  return hash32(
    JSON.stringify({
      id: section.id,
      bpm,
      genre: spec.genre,
      key: `${spec.key?.tonic}${spec.key?.mode}`,
      bars: section.bars,
      tone: section.tone,
      reverbMood: spec.mood,
      instrumentalOnly: !!spec.instrumentalOnly,
      noteDigest,
    }),
  );
}

function findLyricSection(lyrics, kind, index) {
  if (!lyrics || !lyrics.sections) return null;
  const exact = lyrics.sections.find((s) => s.kind === kind && s.index === index);
  if (exact) return exact;
  // chorus 2/3 repeat chorus 1 unless separately written
  return lyrics.sections.find((s) => s.kind === kind) || null;
}

function countFallback(text) {
  return Math.max(1, text.replace(/\s+/g, '').length / 2) | 0;
}

function gain(x) {
  return (x ?? 0) > 0.02;
}

function lvl(base, density, intensity) {
  return (base ?? 0) * density * (0.55 + 0.45 * intensity);
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

/** Human-readable section list for the UI timeline. */
export function sectionSummary(score, locale = 'ko') {
  return score.sections.map((s) => ({
    id: s.id,
    label: (SECTION_LABELS[s.kind] || { ko: s.kind, en: s.kind })[locale] + (s.index > 1 ? ` ${s.index}` : ''),
    startTime: s.startTime,
    duration: s.duration,
    kind: s.kind,
    instruments: Object.keys(s.tracks),
  }));
}
