/**
 * player.js — transport + waveform + synchronised lyric display.
 *
 * The waveform is drawn from precomputed peaks (as the spec requires), section
 * markers come from the score, and lyric lines are highlighted from the note
 * timings the arranger produced — so "synchronised lyrics" needs no separate
 * alignment step.
 */

import { computePeaks } from '../audio/wav.js';
import { toAudioBuffer } from '../audio/renderer.js';
import { fmtTime } from './dom.js';

let sharedCtx = null;
export function audioContext() {
  if (!sharedCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    sharedCtx = new AC({ sampleRate: 44100 });
  }
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

export class Player {
  constructor() {
    this.buffer = null;
    this.peaks = null;
    this.score = null;
    this.source = null;
    this.gain = null;
    this.startedAt = 0;
    this.offset = 0;
    this.playing = false;
    this.listeners = new Set();
    this._raf = null;
    this.label = '';
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    const t = this.currentTime();
    for (const fn of this.listeners) fn({ time: t, playing: this.playing, duration: this.duration(), label: this.label });
  }

  load({ pcm, sampleRate, score, label }) {
    this.stop();
    const ctx = audioContext();
    this.buffer = toAudioBuffer(ctx, pcm, sampleRate);
    this.peaks = computePeaks(pcm, 1000);
    this.score = score;
    this.label = label || '';
    this.offset = 0;
    this._emit();
  }

  duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  currentTime() {
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    return Math.min(this.duration(), this.offset + (audioContext().currentTime - this.startedAt));
  }

  play(from) {
    if (!this.buffer) return;
    const ctx = audioContext();
    this.stopSource();
    this.offset = from !== undefined ? from : this.currentTime();
    if (this.offset >= this.duration() - 0.05) this.offset = 0;
    this.source = ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.gain = ctx.createGain();
    this.gain.gain.value = 1;
    this.source.connect(this.gain).connect(ctx.destination);
    this.source.onended = () => {
      if (this.playing && this.currentTime() >= this.duration() - 0.1) {
        this.playing = false;
        this.offset = 0;
        this._emit();
      }
    };
    this.source.start(0, this.offset);
    this.startedAt = ctx.currentTime;
    this.playing = true;
    this._tick();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime();
    this.stopSource();
    this.playing = false;
    this._emit();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t) {
    const was = this.playing;
    this.offset = Math.max(0, Math.min(this.duration(), t));
    if (was) this.play(this.offset);
    else this._emit();
  }

  stopSource() {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch (e) { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  stop() {
    this.stopSource();
    this.playing = false;
    this.offset = 0;
    this._emit();
  }

  _tick() {
    this._emit();
    if (this.playing) this._raf = requestAnimationFrame(() => this._tick());
  }

  /** Absolute-time lyric lines for synced display. */
  lyricTimeline() {
    if (!this.score) return [];
    const out = [];
    for (const s of this.score.sections) {
      for (const lt of s.lineTimings || []) {
        out.push({
          sectionId: s.id,
          kind: s.kind,
          text: lt.text,
          start: s.startTime + lt.startBeat * this.score.beatSeconds,
          end: s.startTime + lt.endBeat * this.score.beatSeconds,
        });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  sectionAt(t) {
    if (!this.score) return null;
    return this.score.sections.find((s) => t >= s.startTime && t < s.startTime + s.duration) || null;
  }
}

const SECTION_COLORS = {
  intro: '#3d4b63', verse: '#4a6fa5', prechorus: '#6b5ca5',
  chorus: '#c96a8b', bridge: '#4f8a7b', solo: '#b98038', outro: '#3d4b63',
};

/** Waveform + section lanes on a canvas. Click/drag to seek. */
export function drawWaveform(canvas, player, { highlightSection } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 110;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const dur = player.duration() || 1;
  const laneH = 16;
  const waveH = h - laneH - 4;

  // section lanes
  if (player.score) {
    for (const s of player.score.sections) {
      const x = (s.startTime / dur) * w;
      const sw = Math.max(1, (s.duration / dur) * w - 1);
      g.fillStyle = SECTION_COLORS[s.kind] || '#444';
      g.globalAlpha = highlightSection === s.id ? 1 : 0.55;
      g.fillRect(x, 0, sw, laneH);
      g.globalAlpha = 1;
      if (sw > 34) {
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.font = '9px ui-sans-serif, system-ui, sans-serif';
        g.fillText(s.id, x + 3, 11);
      }
    }
  }

  // waveform
  const peaks = player.peaks;
  if (peaks) {
    const mid = laneH + 4 + waveH / 2;
    const grad = g.createLinearGradient(0, laneH, 0, h);
    grad.addColorStop(0, '#8ea8ff');
    grad.addColorStop(1, '#5f6fd0');
    g.fillStyle = grad;
    const n = peaks.length;
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((x / w) * n);
      const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * n));
      let m = 0;
      for (let i = i0; i < i1 && i < n; i++) m = Math.max(m, peaks[i]);
      const bh = Math.max(1, m * waveH * 0.94);
      g.fillRect(x, mid - bh / 2, 1, bh);
    }
  }

  // playhead
  const px = (player.currentTime() / dur) * w;
  g.fillStyle = '#ffd479';
  g.fillRect(px - 1, laneH, 2, h - laneH);
}

export function attachSeek(canvas, player) {
  const seekTo = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    player.seek((x / rect.width) * player.duration());
  };
  canvas.addEventListener('click', seekTo);
  canvas.addEventListener('touchstart', (e) => { seekTo(e); }, { passive: true });
  canvas.style.cursor = 'pointer';
}

export function timeLabel(player) {
  return `${fmtTime(player.currentTime())} / ${fmtTime(player.duration())}`;
}
