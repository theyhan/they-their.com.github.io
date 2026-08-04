/**
 * studio.js — the seven-step gift-song journey from PRD §8, wired end to end.
 *
 * Everything here runs in the browser: no server, no music API. That is the
 * point — it makes the workflow, the rights controls and the revision model
 * testable before Phase 0 provider selection is finished.
 */

import { el, $, clear, fmtTime, fmtKrw, download, toast, confirmDialog } from './ui/dom.js';
import { Player, drawWaveform, attachSeek, audioContext } from './ui/player.js';
import { mountEngPanel, toggleEngPanel, renderEng } from './ui/engpanel.js';
import { drawLyricCard, cardToBlob } from './ui/lyriccard.js';

import * as store from './core/store.js';
import * as DNA from './domain/dna.js';
import * as Story from './domain/story.js';
import * as L from './domain/lyrics.js';
import { deriveSpec, makeVariantPair, applyRevision, diffScores, matchIntent, REVISION_INTENTS } from './domain/spec.js';
import * as Rights from './domain/rights.js';
import { resolveExecutionPlan, ACTIVE_ADAPTERS } from './domain/capability.js';

import { arrange, sectionSummary, SECTION_LABELS } from './audio/arranger.js';
import { SongRenderer, renderPreview } from './audio/renderer.js';
import { encodeWav, computePeaks, sha256Hex } from './audio/wav.js';
import { similarityCheck } from './audio/fingerprint.js';
import { PROGRESSIONS, GENRE_LABELS } from './audio/theory.js';

const LOCALE = 'ko';

const STEPS = [
  { n: 1, title: '상황 선택' },
  { n: 2, title: '이야기 입력' },
  { n: 3, title: '음악 방향' },
  { n: 4, title: '가사' },
  { n: 5, title: '두 버전 비교' },
  { n: 6, title: '구간 수정' },
  { n: 7, title: '라이선스 · 받기' },
];

const app = {
  step: 1,
  occasion: null,
  answers: {},
  brief: null,
  lyrics: null,
  spec: null,
  pair: null,
  explain: null,
  scores: {},
  renders: {},
  peaks: {},
  similarity: {},
  selected: null,
  playingVariant: null,
  license: null,
  provenance: null,
  wavBlob: null,
  choices: {},
  profile: null,
  renderer: new SongRenderer(),
  player: new Player(),
  busy: false,
};

/* ------------------------------------------------------------------ *
 * boot
 * ------------------------------------------------------------------ */

function boot() {
  const s = store.load();
  app.profile = s.profile || DNA.emptyProfile(LOCALE);
  if (!s.profile) store.update((st) => { st.profile = app.profile; });

  const params = new URLSearchParams(location.search);
  const occ = params.get('occasion');
  if (occ && Story.OCCASIONS[occ]) app.occasion = occ;

  mountEngPanel();
  app.player.on(onTick);
  renderSteps();
  renderStep();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleEngPanel(false);
    if (e.code === 'Space' && e.target === document.body && app.player.duration()) {
      e.preventDefault();
      app.player.toggle();
    }
  });
}

function renderSteps() {
  const list = clear($('#stepList'));
  for (const s of STEPS) {
    const cls = s.n === app.step ? 'active' : s.n < app.step ? 'done clickable' : '';
    list.append(
      el(
        'li',
        {
          class: cls,
          onclick: s.n < app.step ? () => go(s.n) : null,
          'aria-current': s.n === app.step ? 'step' : null,
        },
        el('span', { class: 'n' }, s.n < app.step ? '✓' : String(s.n)),
        el('span', {}, s.title),
      ),
    );
  }
}

function go(step) {
  app.step = step;
  renderSteps();
  renderStep();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderStep() {
  const host = clear($('#stepBody'));
  const fns = { 1: stepOccasion, 2: stepStory, 3: stepDirection, 4: stepLyrics, 5: stepCompare, 6: stepRevise, 7: stepDeliver };
  host.append(fns[app.step]());
  renderEng();
}

function head(kicker, title, desc) {
  return el(
    'div',
    { class: 'step-head' },
    el('div', { class: 'kicker' }, kicker),
    el('h2', {}, title),
    desc ? el('p', { class: 'muted' }, desc) : null,
  );
}

/* ------------------------------------------------------------------ *
 * step 1 — occasion
 * ------------------------------------------------------------------ */

function stepOccasion() {
  const wrap = el('div', { class: 'stack' });
  wrap.append(head('Step 1 / 7', '어떤 순간을 위한 노래인가요?', '음악 용어는 묻지 않습니다. 상황과 이야기만 알려주세요.'));

  const grid = el('div', { class: 'opt-grid' });
  for (const [id, o] of Object.entries(Story.OCCASIONS)) {
    grid.append(
      el(
        'button',
        {
          class: 'opt' + (app.occasion === id ? ' on' : ''),
          onclick: () => { app.occasion = id; renderStep(); },
          'aria-pressed': String(app.occasion === id),
        },
        o[LOCALE],
        o.sensitive ? el('span', { class: 'sub' }, '민감한 주제 — 보컬 정책이 더 엄격하게 적용됩니다') : null,
      ),
    );
  }
  wrap.append(el('div', { class: 'panel' }, grid));

  if (app.occasion === 'custom') {
    wrap.append(
      el(
        'label',
        { class: 'field' },
        el('span', { class: 'lbl' }, '상황을 직접 적어주세요'),
        el('input', {
          type: 'text', id: 'occCustom', maxlength: 40, value: app.answers.occasionCustom || '',
          oninput: (e) => { app.answers.occasionCustom = e.target.value; },
        }),
      ),
    );
  }

  if (app.occasion === 'memorial') {
    wrap.append(
      el(
        'div',
        { class: 'notice notice-warn' },
        el('strong', {}, '추모곡 안내: '),
        '고인이나 특정 인물의 목소리를 재현하는 요청은 처리하지 않습니다. 가사와 편곡으로만 그 사람을 기억하는 방식으로 만들어 드립니다.',
      ),
    );
  }

  wrap.append(
    el(
      'div',
      { class: 'step-actions' },
      el(
        'button',
        {
          class: 'btn btn-primary btn-lg',
          disabled: !app.occasion,
          onclick: () => {
            const label = app.occasion === 'custom'
              ? (app.answers.occasionCustom || '직접 입력')
              : Story.OCCASIONS[app.occasion][LOCALE];
            if (!store.currentProject() || store.currentProject().status !== 'intake') {
              store.createProject({ occasion: app.occasion, occasionLabel: label });
            } else {
              store.patchProject(store.currentProject().id, { occasion: app.occasion, occasionLabel: label });
            }
            go(2);
          },
        },
        '이야기 쓰러 가기',
      ),
    ),
  );
  return wrap;
}

/* ------------------------------------------------------------------ *
 * step 2 — story intake
 * ------------------------------------------------------------------ */

function stepStory() {
  const wrap = el('div', { class: 'stack' });
  wrap.append(head('Step 2 / 7', '이야기를 들려주세요', '입력한 내용은 이 브라우저에만 저장되고, 민감한 정보는 자동으로 표시해 드립니다.'));

  const flagBox = el('div', { id: 'flagBox' });
  const form = el('div', { class: 'panel' });

  for (const q of Story.QUESTIONS) {
    const input = q.multiline
      ? el('textarea', { id: 'q_' + q.id, maxlength: q.maxLen, placeholder: q.placeholder[LOCALE] })
      : el('input', { type: 'text', id: 'q_' + q.id, maxlength: q.maxLen, placeholder: q.placeholder[LOCALE] });
    input.value = app.answers[q.id] || '';
    const counter = el('div', { class: 'counter' }, `${input.value.length}/${q.maxLen}`);
    input.addEventListener('input', () => {
      app.answers[q.id] = input.value;
      counter.textContent = `${input.value.length}/${q.maxLen}`;
      updateFlags(flagBox);
    });
    form.append(
      el(
        'label',
        { class: 'field', for: 'q_' + q.id },
        el('span', { class: 'lbl' }, q.label[LOCALE], q.required ? '' : ' (선택)'),
        el('span', { class: 'hint' }, classificationHint(q)),
        input,
        counter,
      ),
    );
  }

  wrap.append(form, flagBox);
  updateFlags(flagBox);

  const summaryBox = el('div', { id: 'summaryBox' });
  wrap.append(summaryBox);

  wrap.append(
    el(
      'div',
      { class: 'step-actions' },
      el('button', { class: 'btn', onclick: () => go(1) }, '뒤로'),
      el(
        'button',
        {
          class: 'btn btn-primary',
          onclick: () => {
            const missing = Story.QUESTIONS.filter((q) => q.required && !(app.answers[q.id] || '').trim());
            if (missing.length) {
              toast('필수 항목을 채워주세요: ' + missing.map((m) => m.label[LOCALE]).join(', '), 'warn');
              return;
            }
            const screen = Rights.screenRequest(Object.values(app.answers).join(' '), { locale: LOCALE });
            store.emit('request_screened', { decision: screen.decision, findings: screen.findings.map((f) => f.id) });
            app.brief = Story.buildBrief({
              occasion: app.occasion,
              occasionCustom: app.answers.occasionCustom,
              answers: app.answers,
              locale: LOCALE,
              privacyMode: 'private',
            });
            store.emit('story_step_completed', { fields: Object.keys(app.answers).length });
            renderSummary(summaryBox, screen);
          },
        },
        '스토리 요약 만들기',
      ),
    ),
  );
  return wrap;
}

function classificationHint(q) {
  const c = Story.CLASSIFICATIONS[q.classification];
  if (q.classification === 'never_store') return '저장하지 않습니다 · 이번 생성에만 사용';
  if (q.classification === 'personal_sensitive') return `민감 정보로 분류 · ${c.retentionDays}일 후 삭제 · 로그 기록 안 함`;
  return `개인정보로 분류 · ${c.retentionDays}일 보관 · 로그는 마스킹`;
}

function updateFlags(box) {
  clear(box);
  const all = [];
  for (const q of Story.QUESTIONS) {
    for (const hit of Story.scanSensitive(app.answers[q.id] || '')) all.push({ ...hit, field: q.label[LOCALE] });
  }
  if (!all.length) return;
  const critical = all.filter((f) => f.severity === 'critical' || f.severity === 'high');
  box.append(
    el(
      'div',
      { class: 'notice ' + (critical.length ? 'notice-warn' : 'notice-info') },
      el('strong', {}, `민감 정보 ${all.length}건 감지 `),
      el('div', { class: 'small', style: 'margin-top:6px' },
        all.slice(0, 6).map((f) =>
          el('div', {}, `· ${f.label[LOCALE]} (${f.field}) — “${f.match.slice(0, 16)}”`)),
      ),
      el('div', { class: 'tiny dim', style: 'margin-top:8px' },
        '주민등록번호·카드번호·연락처는 가사에 넣을 이유가 없습니다. 남겨두면 민감 정보로 분류되어 별도 보관되고 로그에는 기록되지 않습니다.'),
    ),
  );
}

function renderSummary(box, screen) {
  clear(box);
  if (screen.decision !== 'allow') {
    box.append(
      el(
        'div',
        { class: 'notice ' + (screen.decision === 'block' ? 'notice-err' : 'notice-warn') },
        el('strong', {}, screen.decision === 'block' ? '처리할 수 없는 요청이 포함되어 있습니다. ' : '요청을 음악적 속성으로 바꿉니다. '),
        screen.userMessage[LOCALE],
        el('ul', { class: 'small', style: 'margin:8px 0 0' },
          screen.suggestedAttributes.map((a) => el('li', {}, a[LOCALE]))),
      ),
    );
    if (screen.decision === 'block') return;
  }

  box.append(
    el(
      'div',
      { class: 'panel' },
      el('div', { class: 'panel-h' }, '스토리 요약 — 이 내용이 가사의 사실 관계가 됩니다'),
      el('pre', { class: 'receipt' }, Story.briefSummary(app.brief, LOCALE)),
      app.brief.prohibitedDetails.length
        ? el('div', { class: 'notice notice-info', style: 'margin-top:10px' },
            el('strong', {}, '금지 항목 적용: '),
            app.brief.prohibitedDetails.join(', ') + ' — 가사에 등장하면 승인이 차단됩니다.')
        : null,
      el(
        'div',
        { class: 'step-actions' },
        el(
          'button',
          {
            class: 'btn btn-primary',
            onclick: () => {
              app.brief.approvedAt = new Date().toISOString();
              const p = store.currentProject();
              store.patchProject(p.id, { brief: Story.persistable(app.brief), recipientAlias: app.brief.recipientAlias });
              safeState(p.id, 'story_approved');
              store.emit('story_approved', { facts: app.brief.approvedFacts.length });
              go(3);
            },
          },
          '이 요약 승인하고 계속',
        ),
      ),
    ),
  );
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ------------------------------------------------------------------ *
 * step 3 — music direction
 * ------------------------------------------------------------------ */

function stepDirection() {
  const wrap = el('div', { class: 'stack' });
  wrap.append(head('Step 3 / 7', '음악 방향 확인', 'Music DNA에서 미리 골라둔 값입니다. 마음에 안 드는 항목만 바꾸세요.'));

  const resolvedWrap = DNA.resolveProfile(app.profile);
  const resolved = resolvedWrap.resolved;

  const summary = el('div', { class: 'panel', id: 'dirSummary' });
  const controls = el('div', { class: 'panel stack' });

  const dims = [
    ['genre', '장르'],
    ['mood', '무드'],
    ['tempo', '템포'],
    ['vocalType', '보컬'],
    ['vocalCharacter', '목소리 결'],
    ['instrumentation', '악기'],
    ['language', '언어'],
    ['structure', '구성'],
  ];

  for (const [dim, label] of dims) {
    const def = DNA.DIMENSIONS[dim];
    const cur = app.choices[dim] ?? resolved[dim].value;
    const chips = el('div', { class: 'chips' });
    for (const [optId, optLabel] of Object.entries(def.options)) {
      const on = def.multi ? [].concat(cur).includes(optId) : cur === optId;
      chips.append(
        el(
          'button',
          {
            class: 'chip', 'aria-pressed': String(on),
            onclick: () => {
              if (def.multi) {
                const list = [].concat(app.choices[dim] ?? resolved[dim].value);
                app.choices[dim] = list.includes(optId) ? list.filter((x) => x !== optId) : [...list, optId];
                if (!app.choices[dim].length) app.choices[dim] = [optId];
              } else {
                app.choices[dim] = optId;
              }
              app.profile = DNA.setExplicit(app.profile, dim, app.choices[dim]);
              store.update((st) => { st.profile = app.profile; });
              store.emit('dna_preference_corrected', { dimension: dim });
              renderStep();
            },
          },
          optLabel[LOCALE],
        ),
      );
    }
    controls.append(
      el(
        'div',
        {},
        el(
          'div',
          { class: 'spread', style: 'margin-bottom:6px' },
          el('span', { style: 'font-weight:600;font-size:14px' }, label),
          provenanceBadge(resolved[dim]),
        ),
        chips,
      ),
    );
  }

  // exclusions
  const exWrap = el('div', { class: 'chips' });
  for (const [optId, optLabel] of Object.entries(DNA.DIMENSIONS.instrumentation.options)) {
    const on = (app.profile.exclusions.instruments || []).includes(optId);
    exWrap.append(
      el(
        'button',
        {
          class: 'chip excl', 'aria-pressed': String(on),
          onclick: () => {
            app.profile = on
              ? DNA.removeExclusion(app.profile, 'instruments', optId)
              : DNA.addExclusion(app.profile, 'instruments', optId);
            store.update((st) => { st.profile = app.profile; });
            renderStep();
          },
        },
        optLabel[LOCALE],
      ),
    );
  }
  controls.append(
    el('div', {},
      el('div', { style: 'font-weight:600;font-size:14px;margin-bottom:6px' }, '제외할 악기 (하드 필터)'),
      exWrap),
  );

  // length
  controls.append(
    el(
      'label',
      { class: 'field' },
      el('span', { class: 'lbl' }, '곡 길이'),
      el(
        'select',
        {
          onchange: (e) => { app.choices.targetSeconds = parseInt(e.target.value, 10); renderStep(); },
        },
        [130, 160, 190, 220].map((sec) =>
          el('option', { value: sec, selected: (app.choices.targetSeconds ?? 190) === sec }, fmtTime(sec))),
      ),
    ),
  );

  // pairwise
  const pairwise = el('div', { class: 'panel stack' });
  pairwise.append(
    el('div', { class: 'panel-h' }, '빠른 취향 학습 (선택)'),
    el('p', { class: 'small muted' }, '두 클립을 실제로 들어보고 고르면 Music DNA에 신호가 쌓입니다. 신호 하나로는 확신하지 않고, 명시적으로 고른 값을 덮어쓰지 않습니다.'),
  );
  for (const item of DNA.PAIRWISE_ITEMS) {
    pairwise.append(pairwiseRow(item));
  }

  wrap.append(el('div', { class: 'grid-2' }, el('div', { class: 'stack' }, controls, pairwise), el('div', { class: 'stack' }, summary)));
  drawDirectionSummary(summary, resolved);

  wrap.append(
    el(
      'div',
      { class: 'step-actions' },
      el('button', { class: 'btn', onclick: () => go(2) }, '뒤로'),
      el(
        'button',
        {
          class: 'btn btn-primary',
          onclick: () => {
            app.spec = deriveSpec(DNA.resolveProfile(app.profile).resolved, app.brief, {
              targetSeconds: app.choices.targetSeconds ?? 190,
              excludedInstruments: app.profile.exclusions.instruments || [],
            });
            store.patchProject(store.currentProject().id, { spec: app.spec });
            app.lyrics = null;
            go(4);
          },
        },
        '이 방향으로 가사 만들기',
      ),
    ),
  );
  return wrap;
}

function provenanceBadge(r) {
  if (r.source === 'explicit') return el('span', { class: 'badge badge-ok' }, '직접 선택');
  if (r.source === 'inferred') {
    return el('span', { class: 'badge badge-info' }, `추론 ${Math.round(r.confidence * 100)}%`);
  }
  return el('span', { class: 'badge' }, r.weakSignal ? `기본값 (약한 신호 ${Math.round(r.weakSignal.confidence * 100)}%)` : '기본값');
}

function drawDirectionSummary(box, resolved) {
  clear(box);
  const g = app.choices.genre ?? resolved.genre.value;
  const moods = [].concat(app.choices.mood ?? resolved.mood.value);
  const inst = [].concat(app.choices.instrumentation ?? resolved.instrumentation.value);
  // built through el() so null children are dropped — Node.append() would
  // stringify them into a literal "null" in the page
  box.append(el(
    'div',
    {},
    el('div', { class: 'panel-h' }, '지금 방향'),
    el('p', { style: 'font-size:17px' },
      `${GENRE_LABELS[g]?.[LOCALE] || g} · ${moods.map((m) => DNA.DIMENSIONS.mood.options[m]?.[LOCALE] || m).join(' + ')}`),
    el('p', { class: 'muted small' },
      `${DNA.DIMENSIONS.tempo.options[app.choices.tempo ?? resolved.tempo.value]?.[LOCALE] || ''} · ` +
      `${DNA.DIMENSIONS.vocalType.options[app.choices.vocalType ?? resolved.vocalType.value]?.[LOCALE] || ''} 보컬 · ` +
      `${inst.map((i) => DNA.DIMENSIONS.instrumentation.options[i]?.[LOCALE] || i).join(', ')}`),
    el('p', { class: 'muted small' }, `길이 ${fmtTime(app.choices.targetSeconds ?? 190)} · ${app.brief?.occasionLabel || ''}`),
    (app.profile.exclusions.instruments || []).length
      ? el('p', { class: 'small' }, el('span', { class: 'badge badge-err' }, '제외'), ' ' +
          app.profile.exclusions.instruments.map((i) => DNA.DIMENSIONS.instrumentation.options[i]?.[LOCALE] || i).join(', '))
      : null,
    el('div', { class: 'notice notice-info', style: 'margin-top:12px' },
      '보컬은 합성된 “가이드 보컬”입니다. 실제 사람의 목소리를 복제하지 않으며, 특정 인물을 모사하지 않습니다.'),
  ));
}

function pairwiseRow(item) {
  const row = el('div', { class: 'panel-tight', style: 'border:1px solid var(--line);border-radius:8px' });
  row.append(el('div', { class: 'small', style: 'margin-bottom:8px' }, item.question[LOCALE]));
  const sides = el('div', { class: 'grid-2' });
  for (const key of ['a', 'b']) {
    const side = item[key];
    const status = el('span', { class: 'tiny dim' });
    sides.append(
      el(
        'div',
        { class: 'row-wrap' },
        el(
          'button',
          {
            class: 'btn btn-sm',
            onclick: async (e) => {
              e.target.disabled = true;
              status.textContent = '만드는 중…';
              try {
                const res = await previewClip(side);
                app.player.load({ pcm: res.pcm, sampleRate: res.sampleRate, score: null, label: side.label[LOCALE] });
                app.playingVariant = null;
                app.player.play(0);
                status.textContent = '재생 중';
              } catch (err) {
                status.textContent = '실패';
                toast('미리듣기 생성 실패: ' + err.message, 'err');
              } finally {
                e.target.disabled = false;
              }
            },
          },
          '▶ ' + side.label[LOCALE],
        ),
        el(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            onclick: () => {
              for (const [dim, value] of side.signals) {
                app.profile = DNA.addSignal(app.profile, { source: 'onboarding_pairwise', dimension: dim, value });
              }
              store.update((st) => { st.profile = app.profile; });
              store.emit('dna_pairwise_answered', { item: item.id, side: key });
              toast('취향 신호를 반영했습니다.', 'ok');
              renderStep();
            },
          },
          '이게 좋아요',
        ),
        status,
      ),
    );
  }
  row.append(sides);
  return row;
}

const previewLyrics = {
  sections: [
    {
      kind: 'chorus', index: 1,
      lines: [
        { id: 'pv1', text: '라라라 라라 라라라', syllables: 8 },
        { id: 'pv2', text: '라라 라라라 라라', syllables: 7 },
      ],
    },
  ],
};

const previewCache = new Map();

async function previewClip(side) {
  const key = JSON.stringify(side.spec);
  if (previewCache.has(key)) return previewCache.get(key);
  const sp = side.spec;
  const genre = PROGRESSIONS[sp.genre] ? sp.genre : 'acoustic_ballad';
  const spec = {
    id: 'preview',
    genre,
    mood: sp.mood || 'warm',
    moods: [sp.mood || 'warm'],
    tempo: sp.tempo || 80,
    key: { tonic: 'C', mode: PROGRESSIONS[genre].mode },
    vocal: sp.vocal || { type: 'female', character: 'warm', warmth: 0.7, level: 1 },
    instruments: { piano: 0, guitar: 0, strings: 0, synth: 0, drums: 0, brass: 0, bass: 0.85, ...sp.instruments },
    instrumentalOnly: false,
    language: 'ko',
    structure: { targetSeconds: 140, wantSolo: false, preset: 'compact' },
    exclusions: [],
    sectionOverrides: {},
    variation: { arrangementDensity: 'full', chorusLift: 0, leadInstrument: 'piano', rhythmFeel: 'straight', tempoDelta: 0 },
    seed: 4242,
    specVersion: 1,
  };
  audioContext();
  const score = arrange(spec, previewLyrics);
  const res = await renderPreview(score, 7, 4);
  previewCache.set(key, res);
  return res;
}

/* ------------------------------------------------------------------ *
 * step 4 — lyrics
 * ------------------------------------------------------------------ */

function stepLyrics() {
  const wrap = el('div', { class: 'stack' });
  wrap.append(head('Step 4 / 7', '가사 초안', '한 줄씩 직접 고칠 수 있고, 잠근 줄은 이후 재생성에서도 바뀌지 않습니다.'));

  if (!app.lyrics) {
    const lang = (app.choices.language ?? DNA.resolveProfile(app.profile).resolved.language.value) === 'en' ? 'en' : 'ko';
    app.lyrics = L.generateLyrics(app.brief, { lang });
    const p = store.currentProject();
    if (p.status === 'story_approved') safeState(p.id, 'lyrics_draft');
    store.emit('lyrics_generated', { language: lang, sections: app.lyrics.sections.length });
    store.recordCost({
      projectId: p.id, stage: 'lyrics', provider: ACTIVE_ADAPTERS.TextModelAdapter.provider,
      model: ACTIVE_ADAPTERS.TextModelAdapter.modelId, units: L.allLines(app.lyrics).length, costUsd: 0, ms: 4,
    });
  }

  const review = L.reviewLyrics(app.lyrics, app.brief);
  const editor = el('div', { class: 'panel' });
  const flaggedIds = new Set(review.flagged.map((f) => f.lineId));
  const violationIds = new Set(review.violations.map((v) => v.lineId));

  for (const section of app.lyrics.sections) {
    const box = el('div', { class: 'lyric-section' });
    box.append(
      el(
        'div',
        { class: 'spread' },
        el('h4', {}, (SECTION_LABELS[section.kind]?.[LOCALE] || section.kind) + ' ' + section.index),
        el(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            onclick: () => {
              app.lyrics = L.regenerateSection(app.lyrics, app.brief, section.kind, section.index);
              store.emit('lyrics_section_regenerated', { section: section.kind + section.index });
              renderStep();
            },
          },
          '이 구간만 다시',
        ),
      ),
    );
    for (const line of section.lines) {
      const cls = 'lyric-line' + (line.locked ? ' locked' : '') +
        (violationIds.has(line.id) ? ' flagged' : flaggedIds.has(line.id) ? ' flagged' : '');
      const input = el('input', {
        type: 'text', value: line.text, 'aria-label': '가사 한 줄',
        readonly: line.locked || null,
        onchange: (e) => {
          app.lyrics = L.editLine(app.lyrics, line.id, e.target.value);
          store.emit('lyrics_edited', { lineId: line.id });
          renderStep();
        },
      });
      box.append(
        el(
          'div',
          { class: cls },
          el(
            'button',
            {
              class: 'lock-btn' + (line.locked ? ' on' : ''),
              title: line.locked ? '잠금 해제' : '이 줄 잠그기',
              'aria-pressed': String(line.locked),
              onclick: () => {
                app.lyrics = L.toggleLock(app.lyrics, line.id);
                store.emit('lyrics_line_locked', { lineId: line.id });
                renderStep();
              },
            },
            line.locked ? '🔒' : '🔓',
          ),
          input,
          el('span', { class: 'syl', title: '음절 수 — 멜로디 리듬에 그대로 반영됩니다' }, String(line.syllables)),
        ),
      );
    }
    editor.append(box);
  }

  const side = el('div', { class: 'stack' });
  side.append(
    el(
      'div',
      { class: 'panel' },
      el('div', { class: 'panel-h' }, '스토리 반영도'),
      el('div', { class: 'meter' }, el('i', { style: `width:${Math.round(review.coverage.overall * 100)}%` })),
      el('p', { class: 'small muted', style: 'margin:8px 0 0' }, `전체 ${Math.round(review.coverage.overall * 100)}% — 입력한 표현이 가사에 남아 있는 비율입니다.`),
      el('div', { class: 'small', style: 'margin-top:8px' },
        review.coverage.perFact.map((f) =>
          el('div', { class: 'spread' }, el('span', { class: 'muted' }, f.label), el('span', {}, `${Math.round(f.coverage * 100)}%`)))),
    ),
    el(
      'div',
      { class: 'panel' },
      el('div', { class: 'panel-h' }, '검수'),
      review.violations.length
        ? el('div', { class: 'notice notice-err' },
            el('strong', {}, '금지 항목이 가사에 있습니다. '),
            review.violations.map((v) => el('div', { class: 'small' }, `“${v.banned}” → ${v.text}`)))
        : el('div', { class: 'notice notice-ok' }, '금지 항목 없음'),
      review.flagged.length
        ? el('div', { class: 'notice notice-warn', style: 'margin-top:8px' },
            el('strong', {}, `확인 필요 ${review.flagged.length}건: `),
            review.flagged.map((f) => el('div', { class: 'small' }, `${f.reason} — ${f.text}`)))
        : null,
      el('p', { class: 'tiny dim', style: 'margin:10px 0 0' },
        `수정 거리 ${review.editDistance.totalDistance} · 손본 줄 ${review.editDistance.editedLines}/${review.editDistance.totalLines} (품질 KPI로 기록됩니다)`),
    ),
    el(
      'div',
      { class: 'panel' },
      el('div', { class: 'panel-h' }, '후렴 대안'),
      app.lyrics.chorusAlternatives.map((alt, i) =>
        el(
          'div',
          { style: 'margin-bottom:10px' },
          el('div', { class: 'small muted' }, alt.lines.slice(0, 2).join(' / ')),
          el(
            'button',
            {
              class: 'btn btn-sm',
              onclick: () => {
                app.lyrics = L.applyChorusAlternative(app.lyrics, alt.id);
                renderStep();
              },
            },
            `대안 ${i + 1} 적용`,
          ),
        )),
    ),
  );

  wrap.append(el('div', { class: 'grid-2' }, editor, side));
  wrap.append(
    el(
      'div',
      { class: 'step-actions' },
      el('button', { class: 'btn', onclick: () => go(3) }, '뒤로'),
      el('button', { class: 'btn btn-ghost', onclick: () => { app.lyrics = null; renderStep(); } }, '전체 다시 쓰기'),
      el(
        'button',
        {
          class: 'btn btn-primary',
          disabled: !review.canApprove,
          title: review.canApprove ? '' : '금지 항목이 남아 있으면 승인할 수 없습니다',
          onclick: () => {
            app.lyrics.approvedAt = new Date().toISOString();
            const p = store.currentProject();
            store.patchProject(p.id, { lyrics: app.lyrics });
            safeState(p.id, 'lyrics_approved');
            store.emit('lyrics_approved', {
              editDistance: review.editDistance.totalDistance,
              coverage: review.coverage.overall,
            });
            go(5);
          },
        },
        '가사 승인하고 두 곡 만들기',
      ),
    ),
  );
  return wrap;
}

/* ------------------------------------------------------------------ *
 * step 5 — generate + compare
 * ------------------------------------------------------------------ */

function stepCompare() {
  const wrap = el('div', { class: 'stack' });
  wrap.append(head('Step 5 / 7', '두 버전 비교', '같은 가사와 같은 씨드에서, 정해진 축 두 개만 다르게 만듭니다. 그래서 차이를 말로 설명할 수 있습니다.'));

  const p = store.currentProject();
  const hasRenders = app.renders.A && app.renders.B;

  if (!hasRenders) {
    wrap.append(
      el(
        'div',
        { class: 'panel stack' },
        el('div', { class: 'spread' },
          el('div', {},
            el('div', { style: 'font-weight:650' }, '포함 내역'),
            el('div', { class: 'small muted' }, '두 가지 버전 · 구간 수정 2회 · 마스터 WAV · 가사 카드 · 라이선스 영수증')),
          el('div', { style: 'text-align:right' },
            el('div', { style: 'font-size:22px;font-weight:700' }, fmtKrw(Rights.LICENSE_TIERS.personal.priceKrw)),
            el('div', { class: 'tiny dim' }, '라이선스는 7단계에서 선택'))),
        el('div', { class: 'notice notice-info' },
          '예상 소요 시간 약 10–40초 (브라우저에서 직접 합성합니다). 같은 요청을 여러 번 눌러도 멱등성 키로 중복 생성·중복 과금이 발생하지 않습니다.'),
        el('div', { class: 'progress', id: 'genProgress' }, el('i')),
        el('div', { class: 'small muted', id: 'genStatus' }, ''),
        el(
          'div',
          { class: 'step-actions' },
          el('button', { class: 'btn', onclick: () => go(4) }, '가사로 돌아가기'),
          el('button', { class: 'btn btn-primary btn-lg', id: 'genBtn', onclick: startGeneration }, '두 버전 생성하기'),
        ),
      ),
    );
    return wrap;
  }

  const grid = el('div', { class: 'grid-2' });
  for (const id of ['A', 'B']) grid.append(variantPanel(id));
  wrap.append(grid);

  wrap.append(
    el(
      'div',
      { class: 'panel stack' },
      el('div', { class: 'panel-h' }, '가사 · 재생 위치'),
      el('div', { class: 'lyric-live', id: 'lyricLive' },
        el('div', { class: 'cur' }, '재생하면 가사가 따라옵니다'),
        el('div', { class: 'nxt' }, '')),
    ),
  );

  wrap.append(
    el(
      'div',
      { class: 'step-actions' },
      el(
        'button',
        {
          class: 'btn btn-primary btn-lg',
          disabled: !app.selected,
          onclick: () => {
            store.emit('variant_selected', { variant: app.selected });
            for (const [dim, value] of [
              ['genre', app.spec.genre],
              ['vocalCharacter', app.spec.vocal.character],
            ]) {
              app.profile = DNA.addSignal(app.profile, { source: 'version_selected', dimension: dim, value });
            }
            store.update((st) => { st.profile = app.profile; });
            safeState(store.currentProject().id, 'revising');
            go(6);
          },
        },
        app.selected ? `버전 ${app.selected}로 계속` : '버전을 선택하세요',
      ),
    ),
  );
  return wrap;
}

function variantPanel(id) {
  const score = app.scores[id];
  const render = app.renders[id];
  const sim = app.similarity[id];
  const explain = app.explain ? app.explain[id === 'A' ? 'a' : 'b'] : [];
  const canvas = el('canvas', { class: 'wave', id: 'wave' + id, 'aria-label': `버전 ${id} 파형` });
  const box = el('div', { class: 'variant' + (app.selected === id ? ' selected' : '') });

  const view = {
    peaks: app.peaks[id],
    score,
    duration: () => (render ? render.pcm[0].length / render.sampleRate : 0),
    currentTime: () => (app.playingVariant === id ? app.player.currentTime() : 0),
  };
  box._view = view;
  box._canvas = canvas;
  box._id = id;

  box.append(
    el('div', { class: 'spread' },
      el('h3', {}, `버전 ${id}`),
      sim
        ? el('span', {
            class: 'badge ' + (sim.decision === 'pass' ? 'badge-ok' : sim.decision === 'review' ? 'badge-warn' : 'badge-err'),
            title: `유사도 ${sim.score} · ${sim.matches[0]?.title || ''}`,
          }, sim.decision === 'pass' ? '유사도 통과' : sim.decision === 'review' ? '검토 필요' : '격리')
        : null),
    el('ul', {}, explain.map((line) => el('li', {}, line))),
    canvas,
    el(
      'div',
      { class: 'transport' },
      el(
        'button',
        {
          class: 'btn btn-sm', id: 'play' + id,
          onclick: () => {
            if (app.playingVariant === id && app.player.playing) {
              app.player.pause();
            } else {
              loadVariant(id);
              app.player.play(app.playingVariant === id ? undefined : 0);
              store.emit('variant_played', { variant: id });
            }
            renderTransport();
          },
        },
        '▶ 재생',
      ),
      el('span', { class: 't', id: 'time' + id }, '0:00'),
      el('div', { class: 'grow' }),
      el(
        'button',
        {
          class: 'btn btn-sm' + (app.selected === id ? ' btn-primary' : ''),
          onclick: () => { app.selected = id; renderStep(); },
        },
        app.selected === id ? '선택됨' : '이 버전 선택',
      ),
    ),
    el('div', { class: 'tiny dim' },
      `${score.templateId} · ${score.sections.length}구간 · ${score.bpm} BPM · ${score.key} · ` +
      `렌더 ${render.stats.renderMs}ms · 피크 ${render.stats.peakDb}dB`),
  );

  requestAnimationFrame(() => {
    attachSeek(canvas, {
      duration: view.duration,
      seek: (t) => { loadVariant(id); app.player.seek(t); },
    });
    drawWaveform(canvas, view);
  });
  return box;
}

function loadVariant(id) {
  if (app.playingVariant === id) return;
  const r = app.renders[id];
  app.player.load({ pcm: r.pcm, sampleRate: r.sampleRate, score: app.scores[id], label: '버전 ' + id });
  app.playingVariant = id;
}

function renderTransport() {
  for (const id of ['A', 'B']) {
    const btn = $('#play' + id);
    if (btn) btn.textContent = app.playingVariant === id && app.player.playing ? '⏸ 일시정지' : '▶ 재생';
  }
}

function onTick() {
  for (const id of ['A', 'B', 'F']) {
    const c = $('#wave' + id);
    if (!c) continue;
    const r = app.renders[id === 'F' ? app.selected : id];
    if (!r) continue;
    drawWaveform(c, {
      peaks: app.peaks[id === 'F' ? app.selected : id],
      score: app.scores[id === 'F' ? app.selected : id],
      duration: () => r.pcm[0].length / r.sampleRate,
      currentTime: () => ((app.playingVariant === id || (id === 'F' && app.playingVariant === app.selected)) ? app.player.currentTime() : 0),
    }, { highlightSection: app.player.sectionAt(app.player.currentTime())?.id });
    const t = $('#time' + id);
    if (t) {
      const cur = (app.playingVariant === id || id === 'F') ? app.player.currentTime() : 0;
      t.textContent = `${fmtTime(cur)} / ${fmtTime(r.pcm[0].length / r.sampleRate)}`;
    }
  }
  renderTransport();
  updateLiveLyrics();
}

function updateLiveLyrics() {
  const box = $('#lyricLive');
  if (!box || !app.player.score) return;
  const t = app.player.currentTime();
  const timeline = app.player.lyricTimeline();
  const cur = timeline.filter((l) => t >= l.start - 0.15).pop();
  const nxt = timeline.find((l) => l.start > t);
  const sec = app.player.sectionAt(t);
  box.firstChild.textContent = cur ? cur.text : (sec ? `(${SECTION_LABELS[sec.kind]?.[LOCALE] || sec.kind})` : '…');
  box.lastChild.textContent = nxt ? nxt.text : '';
}

function safeState(projectId, next) {
  try {
    store.setProjectState(projectId, next);
    return true;
  } catch (e) {
    console.warn(e.message);
    return false;
  }
}

async function generateVariants(p, bar, status) {
  app.pair = makeVariantPair(app.spec, LOCALE);
  app.explain = app.pair.explain(LOCALE);
  const total = 2;
  let done = 0;
  for (const [id, variantSpec] of [['A', app.pair.a], ['B', app.pair.b]]) {
    const score = arrange(variantSpec, app.lyrics);
    app.scores[id] = score;
    if (status) status.textContent = `버전 ${id} 렌더링…`;
    const res = await app.renderer.render(score, {
      onProgress: ({ done: d, total: t2, sectionId }) => {
        if (bar) bar.style.width = `${Math.round(((done + d / t2) / total) * 100)}%`;
        if (status) status.textContent = `버전 ${id} — ${sectionId} (${d}/${t2})`;
      },
    });
    app.renders[id] = res;
    app.peaks[id] = computePeaks(res.pcm, 1000);
    app.similarity[id] = similarityCheck(score);
    store.emit('similarity_checked', { variant: id, decision: app.similarity[id].decision, score: app.similarity[id].score });
    store.recordCost({
      projectId: p.id, stage: 'music_generation:' + id,
      provider: ACTIVE_ADAPTERS.MusicGenerationAdapter.provider,
      model: ACTIVE_ADAPTERS.MusicGenerationAdapter.modelId,
      units: res.stats.renderedSections, costUsd: 0, ms: res.stats.renderMs,
      meta: { cached: res.stats.cachedSections },
    });
    done++;
  }
  return { variants: ['A', 'B'], axes: app.pair.axes };
}

async function startGeneration() {
  if (app.busy) return;
  app.busy = true;
  const btn = $('#genBtn');
  const bar = $('#genProgress').firstChild;
  const status = $('#genStatus');
  btn.disabled = true;

  const p = store.currentProject();
  const idemKey = `gen:${p.id}:${app.spec.id}:v${app.lyrics.version}:${app.lyrics.approvedAt}`;

  try {
    audioContext(); // must happen inside the click gesture
    const paid = await confirmDialog(
      `${fmtKrw(Rights.LICENSE_TIERS.personal.priceKrw)} 결제를 시뮬레이션합니다. 두 버전과 구간 수정 2회가 포함됩니다.`,
      { confirmText: '결제하고 생성', cancelText: '취소' },
    );
    if (!paid) { btn.disabled = false; app.busy = false; return; }

    safeState(p.id, 'generating');
    store.emit('generation_started', { specId: app.spec.id, variants: 2 });

    const outcome = await store.withIdempotency(
      idemKey,
      async () => {
        const summary = await generateVariants(p, bar, status);
        store.patchProject(p.id, {
          entitlement: { ...p.entitlement, paid: true, orderId: 'ord_sim_' + Date.now().toString(36) },
          variants: {
            A: { specVersion: app.pair.a.specVersion, axes: app.pair.axes },
            B: { specVersion: app.pair.b.specVersion, axes: app.pair.axes },
          },
        });
        return summary;
      },
      { operation: 'ab_generation' },
    );

    if (outcome.inFlight) {
      toast('동일한 요청이 이미 처리 중입니다. 중복 과금 없이 기다립니다.', 'warn');
      btn.disabled = false;
      app.busy = false;
      return;
    }
    if (outcome.replayed) {
      toast('이미 결제·생성된 요청입니다. 추가 과금 없이 오디오만 다시 만듭니다.', 'ok');
      if (!app.renders.A || !app.renders.B) await generateVariants(p, bar, status);
    }

    safeState(p.id, 'safety_check');
    const blocked = Object.values(app.similarity).some((s) => s.decision === 'quarantine');
    if (blocked) {
      safeState(p.id, 'quarantined');
      app.renders = {};
      toast('유사도 검사에서 격리되었습니다. 다시 생성해 주세요.', 'err');
      app.busy = false;
      renderStep();
      return;
    }
    safeState(p.id, 'comparison');
    store.emit('generation_completed', {
      renderMsA: app.renders.A.stats.renderMs,
      renderMsB: app.renders.B.stats.renderMs,
      cachedB: app.renders.B.stats.cachedSections,
    });
    app.busy = false;
    renderStep();
  } catch (err) {
    app.busy = false;
    store.emit('generation_failed', { message: String(err.message || err) });
    safeState(p.id, 'generation_failed');
    toast('생성 실패: ' + err.message + ' — 재시도해도 중복 과금은 없습니다.', 'err');
    if (btn) btn.disabled = false;
    console.error(err);
  }
}

/* ------------------------------------------------------------------ *
 * step 6 — targeted revision
 * ------------------------------------------------------------------ */

function stepRevise() {
  const wrap = el('div', { class: 'stack' });
  wrap.append(head('Step 6 / 7', '원하는 부분만 고치기', '전체를 다시 만들지 않습니다. 바뀐 구간만 다시 렌더링하고, 몇 개를 다시 만들었는지 그대로 보여드립니다.'));

  const p = store.currentProject();
  const left = Math.max(0, p.entitlement.includedRevisions - p.entitlement.usedRevisions);
  const render = app.renders[app.selected];
  const score = app.scores[app.selected];

  const canvas = el('canvas', { class: 'wave', id: 'waveF', 'aria-label': '선택한 버전 파형' });
  const sections = sectionSummary(score, LOCALE);

  wrap.append(
    el(
      'div',
      { class: 'panel stack' },
      el('div', { class: 'spread' },
        el('div', { style: 'font-weight:650' }, `버전 ${app.selected}`),
        el('span', { class: 'badge ' + (left ? 'badge-info' : 'badge-warn') }, `남은 수정 ${left}회`)),
      canvas,
      el(
        'div',
        { class: 'transport' },
        el('button', {
          class: 'btn btn-sm',
          onclick: () => { loadVariant(app.selected); app.player.toggle(); },
        }, '▶ 재생 / 일시정지'),
        el('span', { class: 't', id: 'timeF' }, '0:00'),
      ),
      el('div', { class: 'lyric-live', id: 'lyricLive' }, el('div', { class: 'cur' }, '…'), el('div', { class: 'nxt' }, '')),
      el('div', { class: 'row-wrap tiny dim' }, sections.map((s) => el('span', { class: 'badge' }, `${s.label} ${fmtTime(s.startTime)}`))),
    ),
  );

  const chips = el('div', { class: 'chips' });
  for (const [id, intent] of Object.entries(REVISION_INTENTS)) {
    chips.append(
      el('button', {
        class: 'chip',
        disabled: !left,
        onclick: () => runRevision(id),
      }, intent.label[LOCALE]),
    );
  }

  const freeInput = el('input', {
    type: 'text',
    placeholder: '예: 후렴을 더 힘있게 / 드럼 좀 줄여줘 / 보컬을 더 따뜻하게',
    'aria-label': '수정 요청',
  });

  wrap.append(
    el(
      'div',
      { class: 'panel stack' },
      el('div', { class: 'panel-h' }, '수정 요청'),
      chips,
      el(
        'div',
        { class: 'row', style: 'margin-top:12px' },
        freeInput,
        el('button', {
          class: 'btn btn-primary',
          disabled: !left,
          onclick: () => {
            const text = freeInput.value.trim();
            if (!text) return;
            const screen = Rights.screenRequest(text, { locale: LOCALE });
            store.emit('request_screened', { decision: screen.decision, findings: screen.findings.map((f) => f.id) });
            if (screen.decision === 'block') {
              toast(screen.userMessage[LOCALE], 'err');
              return;
            }
            const intentId = matchIntent(text);
            if (!intentId) {
              toast('아직 이해하지 못하는 요청입니다. 위 버튼 중에서 골라주세요.', 'warn');
              return;
            }
            runRevision(intentId, text);
          },
        }, '적용'),
      ),
      el('div', { id: 'revLog', class: 'stack' }, revisionLog(p)),
    ),
  );

  wrap.append(
    el(
      'div',
      { class: 'step-actions' },
      el('button', { class: 'btn', onclick: () => { safeState(p.id, 'comparison'); go(5); } }, '비교 화면으로'),
      el('button', {
        class: 'btn btn-primary btn-lg',
        onclick: () => {
          safeState(p.id, 'comparison');
          safeState(p.id, 'finalized');
          store.emit('finalized', { variant: app.selected, revisions: p.entitlement.usedRevisions });
          go(7);
        },
      }, '이 버전으로 확정'),
    ),
  );

  requestAnimationFrame(() => {
    attachSeek(canvas, { duration: () => render.pcm[0].length / render.sampleRate, seek: (t) => { loadVariant(app.selected); app.player.seek(t); } });
    onTick();
  });
  return wrap;
}

function revisionLog(p) {
  if (!p.revisions.length) return el('p', { class: 'small dim' }, '아직 수정 기록이 없습니다.');
  return p.revisions.map((r) =>
    el(
      'div',
      { class: 'notice notice-ok small' },
      el('strong', {}, r.label),
      ` — ${r.mode === 'section_patch' ? '구간 패치' : '전체 재생성'} · 전체 ${r.sectionCount}구간 중 ${r.rerendered}구간 재렌더 · ${r.ms}ms`,
      r.changed.length ? el('div', { class: 'tiny dim' }, '변경 구간: ' + r.changed.join(', ')) : null,
    ));
}

async function runRevision(intentId, freeText) {
  if (app.busy) return;
  const p = store.currentProject();
  if (p.entitlement.usedRevisions >= p.entitlement.includedRevisions) {
    toast('포함된 수정 횟수를 모두 사용했습니다.', 'warn');
    return;
  }
  app.busy = true;
  const variant = app.selected;
  const prevScore = app.scores[variant];
  const baseSpec = variant === 'A' ? app.pair.a : app.pair.b;

  try {
    store.emit('revision_requested', { intent: intentId, text: freeText || null, variant });
    const { spec: revised, intent } = applyRevision(baseSpec, intentId);
    const nextScore = arrange(revised, app.lyrics);
    const diff = diffScores(prevScore, nextScore);
    const plan = resolveExecutionPlan({
      providerId: ACTIVE_ADAPTERS.MusicGenerationAdapter.provider,
      scope: intent.scope,
      sectionCount: nextScore.sections.length,
      changedSections: diff.changed.length,
      durationSeconds: nextScore.duration,
    });
    toast(plan.userMessage[LOCALE], 'info');

    const res = await app.renderer.render(nextScore, {
      onProgress: () => {},
    });

    if (variant === 'A') app.pair.a = revised; else app.pair.b = revised;
    app.scores[variant] = nextScore;
    app.renders[variant] = res;
    app.peaks[variant] = computePeaks(res.pcm, 1000);
    app.similarity[variant] = similarityCheck(nextScore);
    app.playingVariant = null;

    store.emit('similarity_checked', { variant, decision: app.similarity[variant].decision, score: app.similarity[variant].score });
    store.recordCost({
      projectId: p.id, stage: 'revision:' + intentId,
      provider: ACTIVE_ADAPTERS.MusicGenerationAdapter.provider,
      model: ACTIVE_ADAPTERS.MusicGenerationAdapter.modelId,
      units: res.stats.renderedSections, costUsd: plan.estimatedCostUsd, ms: res.stats.renderMs,
      meta: { mode: plan.mode, cached: res.stats.cachedSections },
    });
    store.patchProject(p.id, {
      entitlement: { ...p.entitlement, usedRevisions: p.entitlement.usedRevisions + 1 },
      revisions: [
        ...p.revisions,
        {
          intentId,
          label: intent.label[LOCALE],
          mode: plan.mode,
          sectionCount: nextScore.sections.length,
          rerendered: res.stats.renderedSections,
          changed: diff.changed,
          ms: res.stats.renderMs,
          at: new Date().toISOString(),
        },
      ],
    });
    store.emit('revision_completed', {
      intent: intentId, rerendered: res.stats.renderedSections,
      sections: nextScore.sections.length, mode: plan.mode,
    });
    app.busy = false;
    renderStep();
    toast(`${nextScore.sections.length}구간 중 ${res.stats.renderedSections}구간만 다시 만들었습니다 (${res.stats.renderMs}ms).`, 'ok');
  } catch (err) {
    app.busy = false;
    console.error(err);
    toast('수정 실패: ' + err.message, 'err');
  }
}

/* ------------------------------------------------------------------ *
 * step 7 — license + delivery
 * ------------------------------------------------------------------ */

function stepDeliver() {
  const wrap = el('div', { class: 'stack' });
  wrap.append(head('Step 7 / 7', '라이선스와 파일 받기', '어떤 용도로 쓸 수 있는지 먼저 확인하고 받아가세요.'));

  const p = store.currentProject();
  const tierBox = el('div', { class: 'tiers' });
  for (const tier of Object.values(Rights.LICENSE_TIERS)) {
    const on = (app.license?.tier || 'personal') === tier.id;
    tierBox.append(
      el(
        'div',
        {
          class: 'tier' + (on ? ' on' : ''),
          role: 'button', tabindex: '0',
          onclick: () => issue(tier.id),
          onkeydown: (e) => { if (e.key === 'Enter') issue(tier.id); },
        },
        el('div', { style: 'font-weight:650' }, tier.name[LOCALE]),
        el('div', { class: 'price' }, fmtKrw(tier.priceKrw)),
        el('ul', {}, tier.permittedUses[LOCALE].map((u) => el('li', {}, u))),
        el('ul', {}, tier.restrictions[LOCALE].slice(0, 3).map((u) => el('li', { class: 'no' }, '✕ ' + u))),
      ),
    );
  }
  wrap.append(tierBox);

  const out = el('div', { class: 'stack', id: 'deliverBox' });
  wrap.append(out);
  if (app.license) renderDelivery(out);
  else out.append(el('div', { class: 'notice notice-info' }, '위에서 라이선스를 선택하면 영수증과 파일이 준비됩니다.'));

  wrap.append(
    el(
      'div',
      { class: 'step-actions' },
      el('button', { class: 'btn', onclick: () => go(6) }, '수정으로 돌아가기' ),
      el('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          if (await confirmDialog('이 프로젝트와 모든 파일 기록을 삭제합니다. 되돌릴 수 없습니다.', { confirmText: '삭제' })) {
            store.deleteProject(p.id);
            location.href = 'index.html';
          }
        },
      }, '프로젝트 삭제'),
    ),
  );
  return wrap;

  function issue(tierId) {
    const prov = Rights.buildProvenance({
      projectId: p.id,
      spec: app.selected === 'A' ? app.pair.a : app.pair.b,
      score: app.scores[app.selected],
      runs: p.revisions.map((r) => ({ intentId: r.intentId, rerendered: r.rerendered, at: r.at })),
      similarity: app.similarity[app.selected],
      humanContributions: {
        lyricEditDistance: L.editDistanceStats(app.lyrics).totalDistance,
        editedLines: L.editDistanceStats(app.lyrics).editedLines,
        lockedLines: L.allLines(app.lyrics).filter((l) => l.locked).length,
        storyFactsProvided: app.brief.approvedFacts.length,
        revisionCount: p.revisions.length,
        variantSelected: app.selected,
        storyCoverage: L.storyCoverage(app.lyrics, app.brief).overall,
      },
      adapters: ACTIVE_ADAPTERS,
      locale: LOCALE,
    });
    const lic = Rights.issueLicense({
      projectId: p.id, tier: tierId, locale: LOCALE,
      assetIds: ['master_wav'], provenanceId: prov.id,
    });
    app.provenance = prov;
    app.license = lic;
    if (p.status === 'finalized') safeState(p.id, 'licensed');
    store.patchProject(p.id, { license: lic, provenance: prov });
    store.emit('license_issued', { tier: tierId });
    renderStep();
  }
}

function renderDelivery(box) {
  clear(box);
  const p = store.currentProject();
  const lic = app.license;
  const render = app.renders[app.selected];
  const score = app.scores[app.selected];
  const bits = lic.tier === 'commercial' ? 24 : 16;

  box.append(
    el(
      'div',
      { class: 'panel' },
      el('div', { class: 'panel-h' }, '라이선스 영수증'),
      el('pre', { class: 'receipt' }, receiptText(lic, app.provenance)),
    ),
  );

  const items = [
    {
      name: `마스터 WAV (${bits}-bit / 44.1kHz)`,
      meta: `${fmtTime(render.pcm[0].length / render.sampleRate)} · 피크 ${render.stats.peakDb}dB · RMS ${render.stats.rmsDb}dB`,
      go: async () => {
        const blob = encodeWav(render.pcm, render.sampleRate, bits);
        app.wavBlob = blob;
        const sum = await sha256Hex(blob);
        app.provenance.assetChecksum = { algorithm: 'sha-256', value: sum, bytes: blob.size };
        store.patchProject(p.id, { provenance: app.provenance });
        download(blob, `soundfit_${p.recipientAlias || 'song'}_${app.selected}.wav`);
        store.emit('download_completed', { asset: 'master_wav', bits });
        toast('체크섬을 생성 기록에 저장했습니다: ' + sum.slice(0, 12) + '…', 'ok');
        renderStep();
      },
    },
    {
      name: '가사 텍스트',
      meta: `${L.allLines(app.lyrics).length}줄 · ${app.lyrics.language}`,
      go: () => {
        download(new Blob([L.plainText(app.lyrics, LOCALE)], { type: 'text/plain;charset=utf-8' }), 'lyrics.txt');
        store.emit('download_completed', { asset: 'lyrics_txt' });
      },
    },
    {
      name: '동기화 가사 (.lrc)',
      meta: '재생 위치에 맞춘 타임코드',
      go: () => {
        download(new Blob([toLrc(score, app.lyrics)], { type: 'text/plain;charset=utf-8' }), 'lyrics.lrc');
        store.emit('download_completed', { asset: 'lyric_sync' });
      },
    },
    {
      name: '가사 카드 (PNG)',
      meta: '1080 × 1350 · 공유용',
      go: async () => {
        const canvas = document.createElement('canvas');
        const chorus = app.lyrics.sections.find((s) => s.kind === 'chorus');
        drawLyricCard(canvas, {
          title: `${p.recipientAlias || ''}에게`,
          recipient: p.recipientAlias,
          occasion: p.occasionLabel,
          lines: chorus.lines.map((l) => l.text),
          theme: app.spec.mood === 'calm' ? 'calm' : app.spec.mood === 'dramatic' ? 'night' : 'warm',
          disclosure: 'AI로 생성된 음악입니다 · SoundFit',
        });
        const blob = await cardToBlob(canvas);
        download(blob, 'lyric_card.png');
        store.emit('download_completed', { asset: 'lyric_card' });
      },
    },
    {
      name: '생성 기록 (provenance.json)',
      meta: '모델 · 씨드 · 수정 이력 · 인적 기여 · AI 고지',
      go: () => {
        download(new Blob([JSON.stringify(app.provenance, null, 2)], { type: 'application/json' }), 'provenance.json');
        store.emit('download_completed', { asset: 'provenance' });
      },
    },
    {
      name: '유사도 검사 보고서',
      meta: `${app.similarity[app.selected].detectorVersion} · 판정 ${app.similarity[app.selected].decision}`,
      go: () => {
        download(new Blob([JSON.stringify(app.similarity[app.selected], null, 2)], { type: 'application/json' }), 'similarity.json');
        store.emit('download_completed', { asset: 'similarity_report' });
      },
    },
  ];

  if (lic.tier === 'commercial') {
    items.splice(1, 0, {
      name: '연주(MR) 버전',
      meta: '보컬 가이드를 빼고 다시 렌더링합니다',
      go: async () => {
        const base = app.selected === 'A' ? app.pair.a : app.pair.b;
        const { spec: instSpec } = applyRevision(base, 'instrumental');
        const instScore = arrange(instSpec, app.lyrics);
        toast('연주 버전 렌더링 중…', 'info');
        const res = await app.renderer.render(instScore);
        download(encodeWav(res.pcm, res.sampleRate, bits), 'instrumental.wav');
        store.emit('download_completed', { asset: 'instrumental' });
        store.recordCost({
          projectId: p.id, stage: 'derivative:instrumental',
          provider: ACTIVE_ADAPTERS.MusicGenerationAdapter.provider,
          model: ACTIVE_ADAPTERS.MusicGenerationAdapter.modelId,
          units: res.stats.renderedSections, costUsd: 0, ms: res.stats.renderMs,
        });
      },
    });
  }

  box.append(
    el(
      'div',
      { class: 'panel' },
      el('div', { class: 'panel-h' }, '받을 파일'),
      el('div', { class: 'dl-list' },
        items.map((it) =>
          el(
            'div',
            { class: 'dl-item' },
            el('div', { class: 'grow' }, el('div', { class: 'name' }, it.name), el('div', { class: 'meta' }, it.meta)),
            el('button', { class: 'btn btn-sm', onclick: it.go }, '받기'),
          ))),
      el('p', { class: 'tiny dim', style: 'margin-top:12px' },
        'MP3는 프로토타입에서 제공하지 않습니다. 인코딩은 배포용 마스터링 서비스의 역할이고, 프로바이더가 실제로 지원하는 포맷만 capability registry에 기록해 제공해야 합니다.'),
    ),
  );

  box.append(
    el(
      'div',
      { class: 'panel stack' },
      el('div', { class: 'panel-h' }, '전달 · 마무리'),
      el(
        'div',
        { class: 'row-wrap' },
        el('button', {
          class: 'btn',
          onclick: () => {
            const id = 'shr_' + Math.random().toString(36).slice(2, 9);
            store.update((st) => {
              st.shares = st.shares || {};
              st.shares[id] = {
                id, projectId: p.id, occasion: p.occasionLabel, recipient: p.recipientAlias,
                lines: app.lyrics.sections.find((s) => s.kind === 'chorus').lines.map((l) => l.text),
                createdAt: new Date().toISOString(), disclosure: app.provenance.disclosure.text,
              };
            });
            store.emit('share_created', { shareId: id });
            const url = `${location.origin}${location.pathname.replace('studio.html', 'share.html')}#${id}`;
            navigator.clipboard?.writeText(url);
            toast('비공개 공유 링크를 복사했습니다 (프로토타입에서는 이 브라우저에서만 열립니다).', 'ok');
          },
        }, '비공개 공유 링크 만들기'),
        el('button', {
          class: 'btn',
          onclick: () => {
            safeState(p.id, 'delivered');
            toast('전달 완료로 표시했습니다.', 'ok');
            renderEng();
          },
          disabled: p.status === 'delivered',
        }, '전달 완료로 표시'),
        el('button', {
          class: 'btn btn-ghost',
          onclick: async () => {
            if (await confirmDialog('결함으로 환불을 요청합니다. 무료 재생성 1회가 우선 제공됩니다.', { confirmText: '요청' })) {
              store.emit('refund_requested', { reason: 'defect' });
              toast('환불 요청이 기록되었습니다.', 'ok');
            }
          },
        }, '환불 요청'),
        el('button', {
          class: 'btn btn-ghost',
          onclick: () => { store.emit('abuse_reported', { source: 'delivery_screen' }); toast('신고가 접수되었습니다.', 'ok'); },
        }, '신고하기'),
      ),
      el(
        'div',
        { class: 'row-wrap' },
        el('span', { class: 'small muted' }, '첫 생성 만족도:'),
        [1, 2, 3, 4, 5].map((n) =>
          el('button', {
            class: 'chip', 'aria-pressed': String(p.rating === n),
            onclick: () => {
              store.patchProject(p.id, { rating: n });
              store.emit('rating_submitted', { rating: n });
              renderStep();
            },
          }, '★'.repeat(n))),
      ),
    ),
  );
}

function receiptText(lic, prov) {
  return [
    `SoundFit 라이선스 영수증`,
    `-----------------------------------------`,
    `라이선스 ID   : ${lic.id}`,
    `등급          : ${lic.tierName} (${lic.tier})`,
    `발급 시각     : ${lic.issuedAt}`,
    `프로젝트      : ${lic.projectId}`,
    `생성 기록 ID  : ${lic.provenanceId}`,
    `정책 버전     : ${lic.policyVersion}`,
    ``,
    `허용된 사용`,
    ...lic.permittedUses.map((u) => ` · ${u}`),
    ``,
    `금지된 사용`,
    ...lic.restrictions.map((u) => ` ✕ ${u}`),
    ``,
    `수익화 허용   : ${lic.monetization ? '예' : '아니오'}`,
    `출처 표기     : ${lic.attributionRequired ? '필요' : '불필요'}`,
    ``,
    `보컬 관련     : ${lic.voiceTerms.note}`,
    ``,
    `권리 안내`,
    lic.ownershipStatement,
    ``,
    `환불 · 재생성`,
    lic.refundPolicy,
    ``,
    `AI 고지       : ${prov.disclosure.text}`,
    `생성 정보     : ${prov.generation.genre} / ${prov.generation.key} / ${prov.generation.tempo}BPM / seed ${prov.generation.seed}`,
    `인적 기여     : 가사 수정거리 ${prov.humanContributions.lyricEditDistance}, 잠근 줄 ${prov.humanContributions.lockedLines}, 수정 ${prov.humanContributions.revisionCount}회, 선택 버전 ${prov.humanContributions.variantSelected}`,
    `유사도 검사   : ${prov.similarity.decision} (${prov.similarity.score}) · ${prov.similarity.detectorVersion}`,
  ].join('\n');
}

function toLrc(score, lyrics) {
  const lines = [`[ti:SoundFit]`, `[re:SoundFit prototype]`, `[ve:1.1]`];
  for (const s of score.sections) {
    for (const lt of s.lineTimings || []) {
      const t = s.startTime + lt.startBeat * score.beatSeconds;
      const mm = String(Math.floor(t / 60)).padStart(2, '0');
      const ss = (t % 60).toFixed(2).padStart(5, '0');
      lines.push(`[${mm}:${ss}]${lt.text}`);
    }
  }
  return lines.join('\n');
}

boot();
