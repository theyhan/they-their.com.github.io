/**
 * dna.js — Music DNA profile: explicit preferences, inferred preferences with
 * confidence + recency decay, exclusions, and a deletable signal log.
 *
 * Rules enforced here (PRD §6.3):
 *  - every inferred preference carries a confidence score
 *  - inferred never silently overrides explicit
 *  - individual signals are deletable and the whole profile is resettable
 */

export const DIMENSIONS = {
  genre: {
    label: { ko: '장르', en: 'Genre' },
    multi: false,
    options: {
      acoustic_ballad: { ko: '어쿠스틱 발라드', en: 'Acoustic ballad' },
      city_pop: { ko: '시티팝', en: 'City pop' },
      indie_folk: { ko: '인디 포크', en: 'Indie folk' },
      cinematic: { ko: '시네마틱', en: 'Cinematic' },
      hiphop_soul: { ko: '힙합/소울', en: 'Hip-hop / soul' },
      jazz_lounge: { ko: '재즈 라운지', en: 'Jazz lounge' },
    },
  },
  mood: {
    label: { ko: '무드', en: 'Mood' },
    multi: true,
    options: {
      warm: { ko: '따뜻함', en: 'Warm' },
      nostalgic: { ko: '그리움', en: 'Nostalgic' },
      uplifting: { ko: '희망적', en: 'Uplifting' },
      calm: { ko: '차분함', en: 'Calm' },
      energetic: { ko: '활기찬', en: 'Energetic' },
      dramatic: { ko: '드라마틱', en: 'Dramatic' },
    },
  },
  tempo: {
    label: { ko: '템포', en: 'Tempo' },
    multi: false,
    options: {
      slow: { ko: '느리게 (60-75)', en: 'Slow (60-75)' },
      moderate: { ko: '보통 (76-100)', en: 'Moderate (76-100)' },
      fast: { ko: '빠르게 (101-130)', en: 'Fast (101-130)' },
    },
  },
  vocalType: {
    label: { ko: '보컬', en: 'Vocal' },
    multi: false,
    options: {
      female: { ko: '여성', en: 'Female' },
      male: { ko: '남성', en: 'Male' },
      duet: { ko: '듀엣', en: 'Duet' },
      instrumental: { ko: '연주곡', en: 'Instrumental' },
    },
  },
  vocalCharacter: {
    label: { ko: '목소리 결', en: 'Vocal character' },
    multi: false,
    options: {
      warm: { ko: '따뜻한', en: 'Warm' },
      clear: { ko: '맑은', en: 'Clear' },
      soft: { ko: '부드러운', en: 'Soft' },
      powerful: { ko: '힘있는', en: 'Powerful' },
      low: { ko: '낮은', en: 'Low' },
      airy: { ko: '바람결 같은', en: 'Airy' },
    },
  },
  instrumentation: {
    label: { ko: '악기', en: 'Instrumentation' },
    multi: true,
    options: {
      piano: { ko: '피아노', en: 'Piano' },
      guitar: { ko: '기타', en: 'Guitar' },
      strings: { ko: '스트링', en: 'Strings' },
      synth: { ko: '신스', en: 'Synth' },
      drums: { ko: '드럼', en: 'Drums' },
      brass: { ko: '브라스', en: 'Brass' },
    },
  },
  language: {
    label: { ko: '언어', en: 'Language' },
    multi: false,
    options: {
      ko: { ko: '한국어', en: 'Korean' },
      en: { ko: '영어', en: 'English' },
      ja: { ko: '일본어', en: 'Japanese' },
      ko_en: { ko: '한국어 + 영어', en: 'Korean + English' },
    },
  },
  structure: {
    label: { ko: '구성', en: 'Structure' },
    multi: false,
    options: {
      early_chorus: { ko: '후렴 빨리', en: 'Early chorus' },
      standard: { ko: '표준 구성', en: 'Standard' },
      with_solo: { ko: '연주 파트 포함', en: 'With instrumental break' },
    },
  },
  context: {
    label: { ko: '용도', en: 'Context' },
    multi: true,
    options: {
      gift: { ko: '선물', en: 'Gift' },
      driving: { ko: '드라이브', en: 'Driving' },
      focus: { ko: '집중', en: 'Focus' },
      sleep: { ko: '수면', en: 'Sleep' },
      workout: { ko: '운동', en: 'Workout' },
      video: { ko: '영상 배경', en: 'Video background' },
    },
  },
};

export const SIGNAL_SOURCES = {
  onboarding_choice: { weight: 1.0, label: { ko: '온보딩 선택', en: 'Onboarding choice' } },
  onboarding_pairwise: { weight: 0.8, label: { ko: '샘플 비교 선택', en: 'Sample comparison' } },
  explicit_edit: { weight: 1.0, label: { ko: '직접 수정', en: 'Direct edit' } },
  version_selected: { weight: 0.7, label: { ko: '버전 선택', en: 'Version selected' } },
  download: { weight: 0.9, label: { ko: '다운로드', en: 'Download' } },
  replay: { weight: 0.35, label: { ko: '반복 재생', en: 'Replay' } },
  like: { weight: 0.6, label: { ko: '좋아요', en: 'Like' } },
  skip: { weight: -0.45, label: { ko: '건너뜀', en: 'Skip' } },
  dislike: { weight: -0.8, label: { ko: '싫어요', en: 'Dislike' } },
  section_feedback: { weight: 0.5, label: { ko: '구간 피드백', en: 'Section feedback' } },
  revision_request: { weight: 0.55, label: { ko: '수정 요청', en: 'Revision request' } },
};

const HALF_LIFE_DAYS = 90;
const SMOOTHING = 1.6;
export const INFER_THRESHOLD = 0.45;

export function emptyProfile(locale = 'ko') {
  return {
    version: 1,
    locale,
    explicit: {},
    exclusions: { instruments: [], moods: [], themes: [], vocal: [] },
    signals: [],
    references: [],
    consent: { behavioralLearning: false, referenceUpload: false, consentVersion: '2026-08-01' },
    updatedAt: new Date().toISOString(),
  };
}

export function setExplicit(profile, dimension, value) {
  const next = clone(profile);
  if (value === null || value === undefined || (Array.isArray(value) && !value.length)) {
    delete next.explicit[dimension];
  } else {
    next.explicit[dimension] = value;
  }
  next.version++;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function addSignal(profile, { source, dimension, value, weight, context }) {
  if (!DIMENSIONS[dimension]) throw new Error('unknown dimension: ' + dimension);
  const next = clone(profile);
  next.signals.push({
    id: `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    source,
    dimension,
    value,
    weight: weight ?? SIGNAL_SOURCES[source]?.weight ?? 0.5,
    context: context || null,
    createdAt: new Date().toISOString(),
  });
  next.version++;
  next.updatedAt = next.signals[next.signals.length - 1].createdAt;
  return next;
}

export function deleteSignal(profile, signalId) {
  const next = clone(profile);
  next.signals = next.signals.filter((s) => s.id !== signalId);
  next.version++;
  return next;
}

export function addExclusion(profile, kind, value) {
  const next = clone(profile);
  if (!next.exclusions[kind]) next.exclusions[kind] = [];
  if (!next.exclusions[kind].includes(value)) next.exclusions[kind].push(value);
  next.version++;
  return next;
}

export function removeExclusion(profile, kind, value) {
  const next = clone(profile);
  next.exclusions[kind] = (next.exclusions[kind] || []).filter((v) => v !== value);
  next.version++;
  return next;
}

function decay(createdAt, now) {
  const days = (now - new Date(createdAt).getTime()) / 86400000;
  return Math.pow(0.5, Math.max(0, days) / HALF_LIFE_DAYS);
}

/**
 * Aggregate signals into inferred preferences with confidence.
 * @returns {Object<string, {value:any, confidence:number, support:number, competing:Array}>}
 */
export function inferPreferences(profile, now = Date.now()) {
  const byDim = {};
  for (const sig of profile.signals) {
    const d = (byDim[sig.dimension] = byDim[sig.dimension] || { scores: {}, count: {}, total: 0 });
    const w = sig.weight * decay(sig.createdAt, now);
    const values = Array.isArray(sig.value) ? sig.value : [sig.value];
    for (const v of values) {
      d.scores[v] = (d.scores[v] || 0) + w;
      d.count[v] = (d.count[v] || 0) + 1;
      d.total += Math.abs(w);
    }
  }
  const out = {};
  for (const [dim, d] of Object.entries(byDim)) {
    const ranked = Object.entries(d.scores)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1]);
    if (!ranked.length) continue;
    const [topValue, topScore] = ranked[0];
    const support = d.count[topValue] || 0;
    let confidence = topScore / (d.total + SMOOTHING);
    if (support < 2) confidence = Math.min(confidence, 0.44); // one signal is never "confident"
    // penalise close competition
    if (ranked[1]) confidence *= 1 - Math.min(0.5, ranked[1][1] / (topScore + 1e-6) * 0.5);
    out[dim] = {
      value: DIMENSIONS[dim]?.multi ? ranked.slice(0, 3).map(([v]) => v) : topValue,
      confidence: +Math.min(0.95, Math.max(0, confidence)).toFixed(3),
      support,
      competing: ranked.slice(1, 4).map(([v, s]) => ({ value: v, score: +s.toFixed(3) })),
      negative: Object.entries(d.scores)
        .filter(([, s]) => s < -0.4)
        .map(([v, s]) => ({ value: v, score: +s.toFixed(3) })),
    };
  }
  return out;
}

export const DEFAULTS = {
  genre: 'acoustic_ballad',
  mood: ['warm'],
  tempo: 'moderate',
  vocalType: 'female',
  vocalCharacter: 'warm',
  instrumentation: ['piano', 'guitar'],
  language: 'ko',
  structure: 'standard',
  context: ['gift'],
};

/**
 * Effective profile used for generation, with provenance for every dimension so
 * the UI can show "you chose this" vs "we inferred this (72%)".
 */
export function resolveProfile(profile, now = Date.now()) {
  const inferred = inferPreferences(profile, now);
  const resolved = {};
  for (const dim of Object.keys(DIMENSIONS)) {
    if (profile.explicit[dim] !== undefined) {
      resolved[dim] = { value: profile.explicit[dim], source: 'explicit', confidence: 1 };
    } else if (inferred[dim] && inferred[dim].confidence >= INFER_THRESHOLD) {
      resolved[dim] = {
        value: inferred[dim].value,
        source: 'inferred',
        confidence: inferred[dim].confidence,
        support: inferred[dim].support,
      };
    } else if (inferred[dim]) {
      resolved[dim] = {
        value: DEFAULTS[dim],
        source: 'default',
        confidence: 0,
        weakSignal: { value: inferred[dim].value, confidence: inferred[dim].confidence },
      };
    } else {
      resolved[dim] = { value: DEFAULTS[dim], source: 'default', confidence: 0 };
    }
  }
  // exclusions are hard filters, applied after resolution
  const exInst = new Set(profile.exclusions.instruments || []);
  if (Array.isArray(resolved.instrumentation.value)) {
    resolved.instrumentation.value = resolved.instrumentation.value.filter((i) => !exInst.has(i));
    if (!resolved.instrumentation.value.length) resolved.instrumentation.value = ['piano'];
  }
  return { resolved, inferred, exclusions: profile.exclusions, profileVersion: profile.version };
}

/** Pairwise onboarding items: each renders to a real playable clip. */
export const PAIRWISE_ITEMS = [
  {
    id: 'pw1',
    question: { ko: '어느 쪽이 더 마음에 드세요?', en: 'Which one do you prefer?' },
    a: { label: { ko: '피아노 중심 발라드', en: 'Piano-led ballad' }, spec: { genre: 'acoustic_ballad', tempo: 72, instruments: { piano: 1, guitar: 0.3, strings: 0.35, bass: 0.7, drums: 0.15 } }, signals: [['genre', 'acoustic_ballad'], ['instrumentation', 'piano'], ['tempo', 'slow']] },
    b: { label: { ko: '리듬감 있는 시티팝', en: 'Groovy city pop' }, spec: { genre: 'city_pop', tempo: 104, instruments: { piano: 0.6, guitar: 0.7, synth: 0.6, bass: 0.9, drums: 0.8 } }, signals: [['genre', 'city_pop'], ['instrumentation', 'synth'], ['tempo', 'fast']] },
  },
  {
    id: 'pw2',
    question: { ko: '어떤 정서가 더 가깝나요?', en: 'Which feeling is closer?' },
    a: { label: { ko: '따뜻하고 담백한', en: 'Warm and plain' }, spec: { genre: 'indie_folk', mood: 'warm', tempo: 84, instruments: { guitar: 1, piano: 0.4, bass: 0.6, drums: 0.3 } }, signals: [['mood', 'warm'], ['genre', 'indie_folk'], ['instrumentation', 'guitar']] },
    b: { label: { ko: '웅장하고 드라마틱한', en: 'Big and dramatic' }, spec: { genre: 'cinematic', mood: 'dramatic', tempo: 76, instruments: { strings: 1, piano: 0.7, brass: 0.5, bass: 0.8, drums: 0.5 } }, signals: [['mood', 'dramatic'], ['genre', 'cinematic'], ['instrumentation', 'strings']] },
  },
  {
    id: 'pw3',
    question: { ko: '보컬 결은 어느 쪽이 좋으세요?', en: 'Which vocal texture do you like?' },
    a: { label: { ko: '부드럽고 따뜻한 보컬', en: 'Soft warm vocal' }, spec: { genre: 'acoustic_ballad', vocal: { type: 'female', character: 'soft', warmth: 0.8 }, tempo: 78, instruments: { piano: 1, guitar: 0.5, bass: 0.7, drums: 0.2 } }, signals: [['vocalCharacter', 'soft'], ['vocalType', 'female']] },
    b: { label: { ko: '낮고 담담한 보컬', en: 'Low, understated vocal' }, spec: { genre: 'hiphop_soul', vocal: { type: 'male', character: 'low', warmth: 0.35 }, tempo: 88, instruments: { piano: 0.6, synth: 0.5, bass: 0.95, drums: 0.85 } }, signals: [['vocalCharacter', 'low'], ['vocalType', 'male']] },
  },
];

export function exportProfile(profile) {
  const { resolved, inferred } = resolveProfile(profile);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      schema: 'soundfit.music-dna/1.1',
      profileVersion: profile.version,
      explicit: profile.explicit,
      inferred,
      effective: resolved,
      exclusions: profile.exclusions,
      consent: profile.consent,
      signalCount: profile.signals.length,
      signals: profile.signals,
    },
    null,
    2,
  );
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
