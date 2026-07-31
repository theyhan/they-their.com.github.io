/**
 * wav.js — 16/24-bit PCM WAV encoding + peak extraction.
 *
 * The prototype ships WAV only. MP3/AAC encoding is intentionally *not* faked
 * client-side: it belongs in the mastering/delivery service, and the capability
 * registry should record which output formats a provider actually supports.
 */

export function encodeWav(pcm, sampleRate, bitDepth = 16) {
  const channels = pcm.length;
  const frames = pcm[0].length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, 'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let off = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const s = Math.max(-1, Math.min(1, pcm[ch][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
  } else {
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const s = Math.max(-1, Math.min(1, pcm[ch][i]));
        const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        view.setUint8(off, v & 0xff);
        view.setUint8(off + 1, (v >> 8) & 0xff);
        view.setUint8(off + 2, (v >> 16) & 0xff);
        off += 3;
      }
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Downsampled absolute peaks for waveform drawing. */
export function computePeaks(pcm, buckets = 900) {
  const n = pcm[0].length;
  const per = Math.max(1, Math.floor(n / buckets));
  const out = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++) {
    const start = b * per;
    let max = 0;
    for (let i = start; i < Math.min(n, start + per); i++) {
      const a = Math.max(Math.abs(pcm[0][i]), Math.abs(pcm[1][i]));
      if (a > max) max = a;
    }
    out[b] = max;
  }
  return out;
}

/** SHA-256 hex of the delivered bytes — goes into the provenance record. */
export async function sha256Hex(blob) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return 'unavailable';
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
