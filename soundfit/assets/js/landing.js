/** landing.js — occasion links + an in-browser demo clip (no audio files shipped). */

import { el, $, toast } from './ui/dom.js';
import { Player, audioContext } from './ui/player.js';
import { OCCASIONS } from './domain/story.js';
import { arrange } from './audio/arranger.js';
import { SongRenderer } from './audio/renderer.js';
import { PROGRESSIONS } from './audio/theory.js';

const grid = $('#occasionGrid');
for (const [id, o] of Object.entries(OCCASIONS)) {
  if (id === 'custom') continue;
  grid.append(
    el('a', { class: 'opt', href: `studio.html?occasion=${id}` },
      o.ko,
      el('span', { class: 'sub' }, o.sensitive ? '보컬 정책이 더 엄격하게 적용됩니다' : '지금 시작하기')),
  );
}

const DEMO_LYRICS = {
  sections: [
    {
      kind: 'verse', index: 1,
      lines: [
        { id: 'd1', text: '그해 겨울 막차를 놓치고', syllables: 11 },
        { id: 'd2', text: '한 시간을 그냥 걸었지', syllables: 10 },
        { id: 'd3', text: '장갑을 바꿔 끼고 웃던 밤', syllables: 12 },
        { id: 'd4', text: '그게 시작이었어', syllables: 8 },
      ],
    },
    {
      kind: 'chorus', index: 1,
      lines: [
        { id: 'd5', text: '너가 있어서 나는 나야', syllables: 10 },
        { id: 'd6', text: '고마워라는 말로는 부족해서', syllables: 13 },
        { id: 'd7', text: '오래 남을 걸 만들었어', syllables: 11 },
        { id: 'd8', text: '우리 계속 여기 있자', syllables: 9 },
      ],
    },
  ],
};

const DEMO_SPEC = {
  id: 'demo',
  genre: 'acoustic_ballad',
  mood: 'warm',
  moods: ['warm', 'nostalgic'],
  tempo: 76,
  key: { tonic: 'F', mode: PROGRESSIONS.acoustic_ballad.mode },
  vocal: { type: 'female', character: 'warm', warmth: 0.78, level: 1 },
  instruments: { piano: 1, guitar: 0.75, strings: 0.55, synth: 0, drums: 0.45, brass: 0, bass: 0.85 },
  instrumentalOnly: false,
  language: 'ko',
  structure: { targetSeconds: 100, wantSolo: false, preset: 'compact' },
  exclusions: [],
  sectionOverrides: {},
  variation: { arrangementDensity: 'full', chorusLift: 1, leadInstrument: 'piano', rhythmFeel: 'straight', tempoDelta: 0 },
  seed: 20260801,
  specVersion: 1,
};

const player = new Player();
const btn = $('#demoBtn');
const status = $('#demoStatus');
let cached = null;

btn.addEventListener('click', async () => {
  if (cached) {
    player.toggle();
    btn.textContent = player.playing ? '⏸ 일시정지' : '▶ 예시 다시 듣기';
    return;
  }
  btn.disabled = true;
  status.textContent = '브라우저에서 합성 중… (10초 정도)';
  try {
    audioContext();
    const score = arrange(DEMO_SPEC, DEMO_LYRICS);
    // keep it short: intro + verse 1 + chorus 1
    const keep = score.sections.slice(0, 3);
    let t = 0;
    for (const s of keep) { s.startTime = t; t += s.duration; }
    const trimmed = { ...score, sections: keep, duration: t };
    const res = await new SongRenderer().render(trimmed, {
      onProgress: ({ done, total }) => { status.textContent = `합성 중… ${done}/${total} 구간`; },
    });
    cached = res;
    player.load({ pcm: res.pcm, sampleRate: res.sampleRate, score: trimmed, label: 'demo' });
    player.play(0);
    status.textContent = `${Math.round(trimmed.duration)}초 · ${score.bpm} BPM · ${score.key} · 합성 ${res.stats.renderMs}ms`;
    btn.textContent = '⏸ 일시정지';
  } catch (e) {
    console.error(e);
    status.textContent = '';
    toast('오디오 합성에 실패했습니다: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

player.on(({ playing }) => {
  if (cached && !playing && btn.textContent.startsWith('⏸')) btn.textContent = '▶ 예시 다시 듣기';
});
