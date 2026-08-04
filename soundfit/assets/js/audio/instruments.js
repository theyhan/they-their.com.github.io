/**
 * instruments.js — Web Audio synth voices.
 *
 * Deliberately small and self-contained: the point is that a real, distinguishable
 * arrangement comes out of the browser with no external audio provider, so the
 * whole product flow (A/B, section revision, mastering, export) can be exercised
 * end to end before a music API is contracted.
 */

import { midiToFreq } from './theory.js';

const ksCache = new Map();

export function createNoiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (s / 0x3fffffff) - 1;
  }
  return buf;
}

/**
 * Exponentially decaying noise impulse response, used with a ConvolverNode.
 * A Schroeder comb/allpass network was measured as an alternative and rendered no
 * faster in this workload (oscillator count dominates, not the convolution), so
 * the better-sounding convolution reverb stays.
 */
export function createReverbIR(ctx, seconds = 2.6, decay = 2.4) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let s = 987654321;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const n = (s / 0x3fffffff) - 1;
      const env = Math.pow(1 - i / len, decay);
      // early reflection sparsity so it does not sound like plain noise
      const sparse = i < ctx.sampleRate * 0.06 ? (Math.random() < 0.35 ? 1 : 0.15) : 1;
      d[i] = n * env * sparse;
    }
  }
  return buf;
}

/** Karplus–Strong plucked string, generated in JS (feedback delay loops are
 *  unreliable at audio-rate pitches in Web Audio). */
function ksBuffer(ctx, freq, seconds, damping) {
  const key = `${Math.round(freq * 4)}|${Math.round(seconds * 20)}|${Math.round(damping * 100)}|${ctx.sampleRate}`;
  if (ksCache.has(key)) return ksCache.get(key);
  const sr = ctx.sampleRate;
  const N = Math.max(8, Math.round(sr / freq));
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  const ring = new Float32Array(N);
  let s = 424242;
  for (let i = 0; i < N; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    ring[i] = (s / 0x3fffffff) - 1;
  }
  let idx = 0;
  let last = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx];
    out[i] = cur;
    const nxt = ring[(idx + 1) % N];
    const avg = (cur + nxt) * 0.5;
    last = avg * 0.5 + last * 0.5; // extra lowpass = softer, more nylon-like
    ring[idx] = (avg * 0.85 + last * 0.15) * damping;
    idx = (idx + 1) % N;
  }
  ksCache.set(key, buf);
  return buf;
}

function env(ctx, param, t, { a, d, s, r, peak = 1, sustain = 0.6 }, dur) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.linearRampToValueAtTime(peak * sustain, t + a + d);
  const holdEnd = Math.max(t + a + d + 0.01, t + dur);
  param.setValueAtTime(peak * sustain, holdEnd);
  param.exponentialRampToValueAtTime(0.0001, holdEnd + r);
}

/* ------------------------------------------------------------------ */

export function makeInstruments(ctx, shared) {
  const noise = shared.noise;

  function piano(dest, note, t, dur, opts = {}) {
    const f = midiToFreq(note.midi);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800 + 5200 * (opts.brightness ?? 0.6) * note.vel;
    lp.Q.value = 0.4;
    g.connect(lp).connect(dest);
    // 3 partials, not 8: a full arrangement schedules ~2k notes per section and
    // oscillator count is the dominant cost in offline rendering.
    const partials = [
      [1, 1, 0.0025],
      [2, 0.4, 0.002],
      [3.01, 0.15, 0.0016],
    ];
    const decay = Math.min(4.2, 0.9 + 2400 / f);
    for (const [mult, amp, att] of partials) {
      const o = ctx.createOscillator();
      o.type = mult === 1 ? 'triangle' : 'sine';
      o.frequency.value = f * mult;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(amp * note.vel * 0.22, t + att);
      og.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(decay, dur + 0.9));
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + Math.min(decay, dur + 1.0) + 0.05);
    }
    // hammer transient only on accented notes (a BufferSource per note is costly)
    if (note.vel > 0.86) {
      const n = ctx.createBufferSource();
      n.buffer = noise;
      n.playbackRate.value = 1.4;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(note.vel * 0.045, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = Math.min(12000, f * 3);
      n.connect(nf).connect(ng).connect(g);
      n.start(t);
      n.stop(t + 0.08);
    }
    g.gain.value = 0.9;
  }

  function guitar(dest, note, t, dur, opts = {}) {
    const f = midiToFreq(note.midi);
    const seconds = Math.min(3.2, Math.max(0.6, dur + 1.2));
    const src = ctx.createBufferSource();
    src.buffer = ksBuffer(ctx, f, seconds, 0.996);
    const g = ctx.createGain();
    g.gain.setValueAtTime(note.vel * 0.5, t);
    g.gain.setValueAtTime(note.vel * 0.5, t + Math.max(0.08, dur * 0.8));
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 110;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 220;
    body.gain.value = 4;
    src.connect(bp).connect(body).connect(g).connect(dest);
    src.start(t);
    src.stop(t + seconds + 0.02);
  }

  function strings(dest, note, t, dur, opts = {}) {
    const f = midiToFreq(note.midi);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400 + 1800 * (opts.brightness ?? 0.5);
    g.connect(lp).connect(dest);
    env(ctx, g.gain, t, { a: 0.22, d: 0.25, r: 0.5, peak: note.vel * 0.15, sustain: 0.85 }, dur);
    // one shared vibrato LFO for the whole note instead of one per detuned voice
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6 + Math.random() * 0.8;
    const vg = ctx.createGain();
    vg.gain.value = 4.5;
    vib.start(t);
    vib.stop(t + dur + 0.6);
    for (const det of [-7, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      vib.connect(vg).connect(o.detune);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.55);
    }
  }

  function pad(dest, note, t, dur, opts = {}) {
    const f = midiToFreq(note.midi);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500 + 2500 * (opts.brightness ?? 0.5);
    g.connect(lp).connect(dest);
    env(ctx, g.gain, t, { a: 0.5, d: 0.3, r: 0.9, peak: note.vel * 0.12, sustain: 0.9 }, dur);
    for (const det of [-9, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 1.0);
    }
  }

  function brass(dest, note, t, dur) {
    const f = midiToFreq(note.midi);
    const g = ctx.createGain();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 2.2;
    bp.Q.value = 1.1;
    g.connect(bp).connect(dest);
    env(ctx, g.gain, t, { a: 0.06, d: 0.12, r: 0.3, peak: note.vel * 0.1, sustain: 0.8 }, dur);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.985, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.07);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.35);
  }

  function bass(dest, note, t, dur) {
    const f = midiToFreq(note.midi);
    const g = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.connect(shaper).connect(lp).connect(dest);
    env(ctx, g.gain, t, { a: 0.012, d: 0.1, r: 0.14, peak: note.vel * 0.42, sustain: 0.7 }, dur);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f / 2;
    const o2g = ctx.createGain();
    o2g.gain.value = 0.5;
    o.connect(g);
    o2.connect(o2g).connect(g);
    o.start(t); o.stop(t + dur + 0.25);
    o2.start(t); o2.stop(t + dur + 0.25);
  }

  const VOWELS = [
    [780, 1150, 2800],  // a
    [420, 1900, 2700],  // e
    [330, 2100, 3200],  // i
    [480, 830, 2700],   // o
    [330, 720, 2500],   // u
  ];

  /**
   * Vocal *guide* voice. This is explicitly a synthesized guide melody, not a
   * simulated human singer — the UI must label it as such.
   */
  function vocal(dest, note, t, dur, opts = {}) {
    const f = midiToFreq(note.midi);
    const warmth = opts.vocalWarmth ?? 0.5;
    const vowel = VOWELS[(note.syllable ?? 0) % VOWELS.length];
    const out = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4600 - 3000 * warmth;
    tone.Q.value = 0.7;
    out.connect(tone).connect(dest);
    env(ctx, out.gain, t, { a: 0.045, d: 0.09, r: 0.16, peak: note.vel * 0.26, sustain: 0.82 }, dur);

    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f * 0.97, t);
    src.frequency.linearRampToValueAtTime(f, t + 0.05);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibG = ctx.createGain();
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.linearRampToValueAtTime(12 + 10 * (1 - warmth), t + Math.min(0.35, dur));
    vib.connect(vibG).connect(src.detune);
    vib.start(t); vib.stop(t + dur + 0.3);

    vowel.forEach((fr, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fr * (1 - 0.06 * warmth);
      bp.Q.value = [7, 9, 11][i];
      const bg = ctx.createGain();
      bg.gain.value = [1, 0.5, 0.22][i] * (i === 0 ? 1 + warmth * 0.5 : 1);
      src.connect(bp).connect(bg).connect(out);
    });
    src.start(t);
    src.stop(t + dur + 0.25);
  }

  function drums(dest, note, t) {
    const m = note.midi;
    if (m === 36) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
      g.gain.setValueAtTime(note.vel * 0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      const sh = ctx.createWaveShaper();
      sh.curve = softClip(2.2);
      o.connect(g).connect(sh).connect(dest);
      o.start(t); o.stop(t + 0.36);
    } else if (m === 38 || m === 39) {
      const n = ctx.createBufferSource();
      n.buffer = noise;
      n.playbackRate.value = m === 39 ? 1.1 : 1;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = m === 39 ? 1500 : 1900;
      bp.Q.value = m === 39 ? 0.7 : 1.1;
      const g = ctx.createGain();
      const decay = m === 39 ? 0.16 : 0.19;
      g.gain.setValueAtTime(note.vel * 0.42, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      n.connect(bp).connect(g).connect(dest);
      n.start(t, Math.random());
      n.stop(t + decay + 0.02);
      if (m === 38) {
        const o = ctx.createOscillator();
        o.frequency.value = 195;
        const og = ctx.createGain();
        og.gain.setValueAtTime(note.vel * 0.14, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        o.connect(og).connect(dest);
        o.start(t); o.stop(t + 0.12);
      }
    } else {
      // hats / ride
      const n = ctx.createBufferSource();
      n.buffer = noise;
      n.playbackRate.value = 1.8;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = m === 51 ? 5200 : 7200;
      const g = ctx.createGain();
      const decay = m === 46 ? 0.24 : m === 51 ? 0.32 : 0.055;
      g.gain.setValueAtTime(note.vel * 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      n.connect(hp).connect(g).connect(dest);
      n.start(t, Math.random());
      n.stop(t + decay + 0.02);
    }
  }

  return {
    piano, guitar, strings, synth: pad, brass, bass, vocal, drums,
    lead: piano,
    leadStrings: strings,
  };
}

function softClip(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export { softClip };
