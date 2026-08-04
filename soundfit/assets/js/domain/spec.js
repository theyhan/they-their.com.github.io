/**
 * spec.js — Music DNA + StoryBrief -> MusicSpec, A/B variation policy, and
 * revision intents.
 *
 * v1.0 of the PRD said "generate two versions with controlled musical differences"
 * without defining what "controlled" means. Here it is defined: both versions
 * share one base seed and differ on exactly N declared axes, so the difference is
 * reproducible, explainable in plain language, and attributable in analytics.
 */

import { seedFrom, PROGRESSIONS } from '../audio/theory.js';

const TEMPO_RANGES = { slow: [64, 76], moderate: [78, 98], fast: [100, 126] };
const TONICS = ['C', 'D', 'Eb', 'F', 'G', 'A', 'Bb'];

export const AB_AXES = [
  {
    id: 'arrangementDensity',
    a: 'lean', b: 'full',
    explain: {
      ko: ['악기를 최소로 두고 목소리를 앞에 둡니다', '악기를 더 채워 풍성하게 만듭니다'],
      en: ['Fewer instruments, voice forward', 'Fuller arrangement'],
    },
  },
  {
    id: 'chorusLift',
    a: 0, b: 1,
    explain: {
      ko: ['후렴 음역을 편안하게 유지합니다', '후렴에서 음을 더 높여 감정을 올립니다'],
      en: ['Chorus stays in a comfortable range', 'Chorus climbs higher for lift'],
    },
  },
  {
    id: 'leadInstrument',
    a: 'piano', b: 'strings',
    explain: {
      ko: ['피아노가 중심 선율을 잡습니다', '스트링이 중심 선율을 잡습니다'],
      en: ['Piano carries the lead line', 'Strings carry the lead line'],
    },
  },
  {
    id: 'rhythmFeel',
    a: 'straight', b: 'sixteenth',
    explain: {
      ko: ['정박 위주의 담백한 리듬입니다', '16비트로 조금 더 움직임을 줍니다'],
      en: ['Straight, plain rhythm', 'Sixteenth-note motion'],
    },
  },
  {
    id: 'tempoDelta',
    a: 0, b: 7,
    explain: {
      ko: ['기준 템포를 유지합니다', '템포를 조금 올려 밝게 만듭니다'],
      en: ['Base tempo', 'Slightly faster and brighter'],
    },
  },
];

const AXES_PER_PAIR = 2;

/**
 * @param {object} resolvedDna output of dna.resolveProfile().resolved
 * @param {object} brief StoryBrief
 * @param {object} choices user overrides from the Music Direction screen
 */
export function deriveSpec(resolvedDna, brief, choices = {}) {
  const val = (dim, fallback) => choices[dim] ?? resolvedDna[dim]?.value ?? fallback;
  const genreRaw = val('genre', 'acoustic_ballad');
  const genre = PROGRESSIONS[genreRaw] ? genreRaw : 'acoustic_ballad';
  const tempoBand = val('tempo', 'moderate');
  const range = TEMPO_RANGES[tempoBand] || TEMPO_RANGES.moderate;
  const moods = [].concat(val('mood', ['warm']));
  const instList = [].concat(val('instrumentation', ['piano', 'guitar']));
  const structure = val('structure', 'standard');

  const seedBase = choices.seed ?? seedFrom(
    JSON.stringify({
      facts: brief.approvedFacts.map((f) => f.value),
      genre, tempoBand, moods, instList, occasion: brief.occasion,
    }),
  );

  const instruments = {
    piano: instList.includes('piano') ? 1 : 0.25,
    guitar: instList.includes('guitar') ? 0.85 : 0,
    strings: instList.includes('strings') ? 0.8 : moods.includes('dramatic') ? 0.4 : 0.25,
    synth: instList.includes('synth') ? 0.7 : 0,
    drums: instList.includes('drums') ? 0.8 : 0.35,
    brass: instList.includes('brass') ? 0.55 : 0,
    bass: 0.85,
  };
  for (const ex of choices.excludedInstruments || []) instruments[ex] = 0;

  const tonic = TONICS[seedBase % TONICS.length];
  const mode = PROGRESSIONS[genre].mode;
  const vocalType = val('vocalType', 'female');
  const vocalCharacter = val('vocalCharacter', 'warm');

  return {
    id: `spec_${seedBase.toString(36)}`,
    genre,
    mood: moods[0] || 'warm',
    moods,
    tempo: Math.round(range[0] + (range[1] - range[0]) * (moods.includes('energetic') ? 0.8 : 0.35)),
    key: { tonic, mode },
    vocal: {
      type: vocalType,
      character: vocalCharacter,
      warmth: vocalCharacter === 'warm' ? 0.75 : vocalCharacter === 'soft' ? 0.65 : vocalCharacter === 'low' ? 0.55 : 0.4,
      level: 1,
    },
    instruments,
    instrumentalOnly: vocalType === 'instrumental',
    language: val('language', 'ko'),
    structure: {
      targetSeconds: choices.targetSeconds ?? 190,
      wantSolo: structure === 'with_solo',
      preset: structure,
    },
    exclusions: choices.excludedInstruments || [],
    sectionOverrides: {},
    variation: { arrangementDensity: 'lean', chorusLift: 0, leadInstrument: 'piano', rhythmFeel: 'straight', tempoDelta: 0 },
    seed: seedBase,
    createdAt: new Date().toISOString(),
    specVersion: 1,
  };
}

/** Pick which axes differ between A and B, deterministically from the seed. */
export function chooseAxes(spec) {
  const pool = AB_AXES.filter((ax) => {
    if (ax.id === 'leadInstrument' && !spec.instruments.strings) return false;
    if (ax.id === 'tempoDelta' && spec.mood === 'calm') return false;
    return true;
  });
  const picked = [];
  let s = spec.seed;
  while (picked.length < Math.min(AXES_PER_PAIR, pool.length)) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const cand = pool[s % pool.length];
    if (!picked.includes(cand)) picked.push(cand);
  }
  return picked;
}

/**
 * @returns {{a:object, b:object, axes:Array, explain:(locale)=>{a:string[],b:string[]}}}
 */
export function makeVariantPair(spec, locale = 'ko') {
  const axes = chooseAxes(spec);
  const a = clone(spec);
  const b = clone(spec);
  a.variantId = 'A';
  b.variantId = 'B';
  for (const ax of axes) {
    a.variation[ax.id] = ax.a;
    b.variation[ax.id] = ax.b;
  }
  // B gets a different orchestration weight when density is one of the axes
  if (axes.some((x) => x.id === 'arrangementDensity')) {
    b.instruments = { ...b.instruments, strings: Math.min(1, (b.instruments.strings || 0) + 0.35) };
  }
  return {
    a,
    b,
    axes: axes.map((ax) => ax.id),
    explain: (loc = locale) => ({
      a: axes.map((ax) => ax.explain[loc]?.[0] ?? ax.explain.en[0]),
      b: axes.map((ax) => ax.explain[loc]?.[1] ?? ax.explain.en[1]),
    }),
  };
}

/* ------------------------- revisions ------------------------- */

export const REVISION_INTENTS = {
  chorus_more_emotional: {
    label: { ko: '후렴을 더 감정적으로', en: 'Make the chorus more emotional' },
    scope: 'section',
    apply(spec) {
      const next = clone(spec);
      for (const id of chorusIds(spec)) {
        next.sectionOverrides[id] = {
          ...(next.sectionOverrides[id] || {}),
          intensity: 1.12,
          brightness: 0.42,
          vocalWarmth: Math.min(1, (spec.vocal.warmth || 0.5) + 0.15),
          // scoped to the chorus: a global strings bump would dirty every section
          levels: { strings: Math.min(1, (spec.instruments.strings || 0) + 0.3) },
        };
      }
      return next;
    },
  },
  chorus_more_powerful: {
    label: { ko: '후렴을 더 힘있게', en: 'Make the chorus more powerful' },
    scope: 'section',
    apply(spec) {
      const next = clone(spec);
      for (const id of chorusIds(spec)) {
        next.sectionOverrides[id] = {
          ...(next.sectionOverrides[id] || {}),
          intensity: 1.25,
          drums: Math.min(1, (spec.instruments.drums || 0.5) + 0.2),
          brightness: 0.7,
        };
      }
      next.variation = { ...next.variation, chorusLift: 1 };
      return next;
    },
  },
  reduce_drums: {
    label: { ko: '드럼을 줄여주세요', en: 'Reduce the drums' },
    scope: 'global',
    apply(spec) {
      const next = clone(spec);
      next.instruments.drums = +((spec.instruments.drums || 0.6) * 0.4).toFixed(3);
      return next;
    },
  },
  vocal_warmer: {
    label: { ko: '보컬을 더 따뜻하게', en: 'Make the vocal warmer' },
    scope: 'global',
    apply(spec) {
      const next = clone(spec);
      next.vocal = { ...next.vocal, warmth: Math.min(1, (spec.vocal.warmth || 0.5) + 0.28) };
      return next;
    },
  },
  more_piano: {
    label: { ko: '피아노를 더 살려주세요', en: 'Bring up the piano' },
    scope: 'global',
    apply(spec) {
      const next = clone(spec);
      next.instruments.piano = Math.min(1.2, (spec.instruments.piano || 0.5) + 0.35);
      return next;
    },
  },
  add_guitar_solo: {
    label: { ko: '두 번째 후렴 뒤에 기타 솔로 추가', en: 'Add a guitar solo after the 2nd chorus' },
    scope: 'structural',
    apply(spec) {
      const next = clone(spec);
      next.structure = { ...next.structure, wantSolo: true, preset: 'with_solo' };
      next.instruments.guitar = Math.max(0.8, next.instruments.guitar || 0.8);
      return next;
    },
  },
  instrumental: {
    label: { ko: '연주(MR) 버전으로', en: 'Create an instrumental version' },
    scope: 'derivative',
    apply(spec) {
      const next = clone(spec);
      next.instrumentalOnly = true;
      next.derivativeOf = spec.id;
      return next;
    },
  },
  slower: {
    label: { ko: '조금 더 느리게', en: 'A little slower' },
    scope: 'structural',
    apply(spec) {
      const next = clone(spec);
      next.tempo = Math.max(56, spec.tempo - 8);
      return next;
    },
  },
};

function chorusIds(spec) {
  return ['chorus1', 'chorus2', 'chorus3'];
}

export function applyRevision(spec, intentId) {
  const intent = REVISION_INTENTS[intentId];
  if (!intent) throw new Error('unknown revision intent: ' + intentId);
  const next = intent.apply(spec);
  next.specVersion = (spec.specVersion || 1) + 1;
  next.revisionHistory = [...(spec.revisionHistory || []), { intentId, at: new Date().toISOString() }];
  return { spec: next, intent: { id: intentId, ...intent } };
}

/**
 * Which sections actually have to be re-rendered. Computed by comparing content
 * hashes, not by trusting the intent's declared scope.
 */
export function diffScores(prevScore, nextScore) {
  const prev = new Map((prevScore?.sections || []).map((s) => [s.id, s.cacheKey]));
  const changed = [];
  const unchanged = [];
  for (const s of nextScore.sections) {
    if (prev.get(s.id) === s.cacheKey) unchanged.push(s.id);
    else changed.push(s.id);
  }
  const structural =
    (prevScore?.sections || []).length !== nextScore.sections.length ||
    (prevScore?.templateId && prevScore.templateId !== nextScore.templateId);
  return {
    changed,
    unchanged,
    structural,
    ratio: nextScore.sections.length ? +(changed.length / nextScore.sections.length).toFixed(2) : 1,
  };
}

/** Free-text revision -> intent, so the UI can accept either. */
export function matchIntent(text) {
  const t = (text || '').toLowerCase();
  const rules = [
    [/(후렴|코러스|chorus).*(강|힘|파워|powerful|big)/, 'chorus_more_powerful'],
    [/(후렴|코러스|chorus).*(감정|애절|emotional|touch)/, 'chorus_more_emotional'],
    [/(드럼|drum).*(줄|빼|less|reduce|down)/, 'reduce_drums'],
    [/(보컬|목소리|vocal).*(따뜻|부드|warm|soft)/, 'vocal_warmer'],
    [/(피아노|piano).*(더|올|up|more)/, 'more_piano'],
    [/(기타|guitar).*(솔로|solo)/, 'add_guitar_solo'],
    [/(mr|연주|반주|instrumental)/, 'instrumental'],
    [/(느리|slow)/, 'slower'],
  ];
  for (const [re, id] of rules) if (re.test(t)) return id;
  return null;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
