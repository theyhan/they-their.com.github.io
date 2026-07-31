/**
 * renderer.js — score -> AudioBuffer, rendered one section at a time.
 *
 * Why per-section: PRD principle "revision must be local". Each section is
 * rendered into its own OfflineAudioContext and cached by its content hash, then
 * overlap-added into the master timeline. A chorus-only revision therefore
 * re-renders 1 of N sections. The renderer reports exactly how many sections it
 * had to redo, which is the metric a real provider integration should also expose.
 */

import { makeInstruments, createNoiseBuffer, createReverbIR, softClip } from './instruments.js';

const SR = 44100;
const TAIL = 1.5;
const IR_SECONDS = 1.8;

const irCache = new Map();

/** The IR is generated once per (rate, length, decay) and copied per context. */
function sharedIR(sampleRate, seconds, decay) {
  const key = `${sampleRate}|${seconds}|${decay}`;
  if (irCache.has(key)) return irCache.get(key);
  const tmp = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  const buf = createReverbIR(tmp, seconds, decay);
  const data = [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
  irCache.set(key, data);
  return data;
}

const REVERB_SEND = {
  piano: 0.22, guitar: 0.18, strings: 0.5, synth: 0.42, brass: 0.32,
  bass: 0.02, vocal: 0.28, drums: 0.1, lead: 0.3, leadStrings: 0.48,
};

export class SongRenderer {
  constructor() {
    /** cacheKey -> {pcm:[Float32Array,Float32Array], length} */
    this.cache = new Map();
    this.lastStats = null;
  }

  invalidate(cacheKey) {
    this.cache.delete(cacheKey);
  }

  clear() {
    this.cache.clear();
  }

  /**
   * @returns {Promise<{pcm:Float32Array[], sampleRate:number, duration:number, stats:object}>}
   */
  async render(score, { onProgress, force = false } = {}) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const totalSamples = Math.ceil((score.duration + TAIL) * SR);
    const out = [new Float32Array(totalSamples), new Float32Array(totalSamples)];
    let rendered = 0;
    let cached = 0;

    for (let i = 0; i < score.sections.length; i++) {
      const section = score.sections[i];
      let entry = force ? null : this.cache.get(section.cacheKey);
      if (entry) {
        cached++;
      } else {
        entry = await this._renderSection(section, score);
        this.cache.set(section.cacheKey, entry);
        rendered++;
      }
      const offset = Math.round(section.startTime * SR);
      for (let ch = 0; ch < 2; ch++) {
        const src = entry.pcm[ch];
        const dst = out[ch];
        const n = Math.min(src.length, totalSamples - offset);
        for (let s = 0; s < n; s++) dst[offset + s] += src[s];
      }
      if (onProgress) {
        onProgress({
          done: i + 1,
          total: score.sections.length,
          sectionId: section.id,
          fromCache: cached > 0 && rendered === 0 ? true : undefined,
        });
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const master = masterBus(out, score);
    const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    this.lastStats = {
      sections: score.sections.length,
      renderedSections: rendered,
      cachedSections: cached,
      renderMs: ms,
      peakDb: master.peakDb,
      rmsDb: master.rmsDb,
    };
    return {
      pcm: out,
      sampleRate: SR,
      duration: totalSamples / SR,
      stats: this.lastStats,
    };
  }

  async _renderSection(section, score) {
    const seconds = section.duration + TAIL;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
    const shared = { noise: createNoiseBuffer(ctx, 2) };
    const inst = makeInstruments(ctx, shared);

    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    const conv = ctx.createConvolver();
    const irData = sharedIR(SR, IR_SECONDS, score.reverb > 0.35 ? 1.9 : 2.6);
    const irBuf = ctx.createBuffer(2, irData[0].length, SR);
    irBuf.copyToChannel(irData[0], 0);
    irBuf.copyToChannel(irData[1], 1);
    conv.buffer = irBuf;
    const wet = ctx.createGain();
    wet.gain.value = score.reverb;
    conv.connect(wet).connect(master);

    const beat = score.beatSeconds;
    for (const [trackName, notes] of Object.entries(section.tracks)) {
      const voice = inst[trackName];
      if (!voice || !notes.length) continue;
      const level = section.levels[trackName] ?? 0.8;
      if (level <= 0.01) continue;
      const trackGain = ctx.createGain();
      trackGain.gain.value = level;
      trackGain.connect(master);
      const send = ctx.createGain();
      send.gain.value = (REVERB_SEND[trackName] ?? 0.2);
      trackGain.connect(send).connect(conv);

      // slight per-track pan for width
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      let dest = trackGain;
      if (pan) {
        pan.pan.value = PAN[trackName] ?? 0;
        pan.connect(trackGain);
        dest = pan;
      }

      for (const n of notes) {
        const t = n.t * beat + 0.02;
        const dur = Math.max(0.06, n.d * beat);
        try {
          voice(dest, n, t, dur, section.tone);
        } catch (e) {
          // one bad note must not kill a whole render
          if (typeof console !== 'undefined') console.warn('note render failed', trackName, e);
        }
      }
    }

    const buf = await ctx.startRendering();
    return {
      pcm: [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()],
      length: buf.length,
    };
  }
}

const PAN = {
  piano: -0.12, guitar: 0.22, strings: -0.3, synth: 0.3, brass: 0.15,
  bass: 0, vocal: 0, drums: 0, lead: 0.05, leadStrings: -0.25,
};

/**
 * Mastering adapter (numeric): headroom trim -> soft saturation -> peak
 * normalisation -> fades. Reported RMS is an approximation, not true LUFS.
 */
function masterBus(pcm, score) {
  const n = pcm[0].length;
  const clip = softClip(1.35);
  let peak = 0;
  let sumSq = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = pcm[ch];
    for (let i = 0; i < n; i++) {
      let x = d[i] * 0.72;
      // waveshaper lookup, matches the tanh curve used on the buses
      const idx = Math.max(0, Math.min(1023, Math.round(((x + 1) / 2) * 1023)));
      x = clip[idx];
      d[i] = x;
      const a = Math.abs(x);
      if (a > peak) peak = a;
      sumSq += x * x;
    }
  }
  const target = 0.891; // ~ -1 dBFS
  const g = peak > 0 ? Math.min(4, target / peak) : 1;
  const fadeIn = Math.round(0.02 * SR);
  const fadeOut = Math.round(Math.min(2.2, 1.6) * SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = pcm[ch];
    for (let i = 0; i < n; i++) {
      let x = d[i] * g;
      if (i < fadeIn) x *= i / fadeIn;
      if (i > n - fadeOut) x *= Math.max(0, (n - i) / fadeOut);
      d[i] = x;
    }
  }
  const rms = Math.sqrt(sumSq / (n * 2)) * g;
  return {
    peakDb: +(20 * Math.log10(peak * g || 1e-6)).toFixed(2),
    rmsDb: +(20 * Math.log10(rms || 1e-6)).toFixed(2),
  };
}

/** Build a playable AudioBuffer for an online AudioContext from raw pcm. */
export function toAudioBuffer(ctx, pcm, sampleRate) {
  const buf = ctx.createBuffer(2, pcm[0].length, sampleRate);
  buf.copyToChannel(pcm[0], 0);
  buf.copyToChannel(pcm[1], 1);
  return buf;
}

/**
 * Short preview clip used by Music DNA pairwise onboarding: take the chorus (or
 * the next best section), keep the first few bars only, render that.
 */
export async function renderPreview(score, seconds = 7, barsKeep = 4) {
  const renderer = new SongRenderer();
  const pick =
    score.sections.find((s) => s.kind === 'chorus') ||
    score.sections.find((s) => s.kind === 'verse') ||
    score.sections[0];
  const keepBeats = barsKeep * 4;
  const tracks = {};
  for (const [name, notes] of Object.entries(pick.tracks)) {
    tracks[name] = notes.filter((n) => n.t < keepBeats);
  }
  const section = {
    ...pick,
    tracks,
    startTime: 0,
    startBeat: 0,
    durationBeats: keepBeats,
    duration: keepBeats * score.beatSeconds,
    cacheKey: pick.cacheKey + '-prev' + barsKeep,
  };
  const trimmed = { ...score, sections: [section], duration: section.duration };
  const res = await renderer.render(trimmed);
  const keep = Math.min(res.pcm[0].length, Math.round(seconds * res.sampleRate));
  return {
    pcm: [res.pcm[0].slice(0, keep), res.pcm[1].slice(0, keep)],
    sampleRate: res.sampleRate,
    duration: keep / res.sampleRate,
    stats: res.stats,
  };
}
