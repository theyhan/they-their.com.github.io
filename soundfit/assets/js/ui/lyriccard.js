/** lyriccard.js — shareable lyric card rendered to PNG (an MVP deliverable). */

const W = 1080;
const H = 1350;

const THEMES = {
  warm: ['#2b1d24', '#6d3b46', '#c98b7a'],
  calm: ['#16212b', '#274456', '#7fa8bd'],
  night: ['#14131f', '#2c2a4a', '#8f86c9'],
  bloom: ['#241a2b', '#4d2b55', '#c98bb9'],
};

export function drawLyricCard(canvas, { title, recipient, occasion, lines, theme = 'warm', disclosure }) {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const [c0, c1, c2] = THEMES[theme] || THEMES.warm;

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, c0);
  bg.addColorStop(0.6, c1);
  bg.addColorStop(1, c0);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // soft light blooms
  for (const [x, y, r, a] of [[820, 260, 380, 0.22], [220, 1080, 420, 0.16]]) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, hexA(c2, a));
    rg.addColorStop(1, hexA(c2, 0));
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  }

  g.strokeStyle = hexA('#ffffff', 0.18);
  g.lineWidth = 2;
  g.strokeRect(56, 56, W - 112, H - 112);

  g.textBaseline = 'top';
  g.fillStyle = hexA('#ffffff', 0.7);
  g.font = '500 30px ui-sans-serif, system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif';
  g.fillText(occasion || '', 110, 130);

  g.fillStyle = '#ffffff';
  g.font = '700 66px ui-serif, Georgia, "Nanum Myeongjo", serif';
  wrap(g, title || '', 110, 190, W - 220, 78);

  g.fillStyle = hexA('#ffffff', 0.82);
  g.font = '400 27px ui-sans-serif, system-ui, sans-serif';
  g.fillText(recipient ? `for ${recipient}` : '', 112, 300);

  // lyric lines
  g.font = '400 40px ui-serif, Georgia, "Nanum Myeongjo", serif';
  let y = 430;
  for (const line of (lines || []).slice(0, 8)) {
    g.fillStyle = hexA('#ffffff', 0.95);
    y = wrap(g, line, 112, y, W - 240, 62) + 22;
  }

  // footer
  g.font = '500 26px ui-sans-serif, system-ui, sans-serif';
  g.fillStyle = hexA('#ffffff', 0.75);
  g.fillText('SoundFit', 112, H - 190);
  g.font = '400 21px ui-sans-serif, system-ui, sans-serif';
  g.fillStyle = hexA('#ffffff', 0.55);
  wrap(g, disclosure || 'AI로 생성된 음악입니다.', 112, H - 150, W - 240, 30);
  return canvas;
}

function wrap(g, text, x, y, maxW, lh) {
  const words = String(text).split(/(\s+)/);
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line + w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line.trim(), x, yy);
      yy += lh;
      line = w.trim() ? w : '';
    } else {
      line = test;
    }
  }
  if (line.trim()) {
    g.fillText(line.trim(), x, yy);
    yy += lh;
  }
  return yy;
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function cardToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
