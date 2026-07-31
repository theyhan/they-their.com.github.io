/**
 * story.js — guided intake -> approved StoryBrief.
 *
 * Adds what v1.0 of the spec left undefined: a field-level data classification
 * so "privacyMode" and "prohibitedDetails" become enforceable, not aspirational.
 */

export const OCCASIONS = {
  anniversary: { ko: '기념일', en: 'Anniversary', defaultMood: ['warm', 'nostalgic'] },
  birthday: { ko: '생일', en: 'Birthday', defaultMood: ['uplifting', 'warm'] },
  wedding: { ko: '결혼 · 프러포즈', en: 'Wedding / proposal', defaultMood: ['warm', 'uplifting'] },
  family: { ko: '가족에게 감사', en: 'Family appreciation', defaultMood: ['warm', 'nostalgic'] },
  friendship: { ko: '우정', en: 'Friendship', defaultMood: ['uplifting'] },
  memorial: { ko: '추모 · 기억', en: 'Memorial / remembrance', defaultMood: ['calm', 'nostalgic'], sensitive: true },
  theme: { ko: '나의 테마곡', en: 'Personal theme song', defaultMood: ['energetic'] },
  custom: { ko: '직접 입력', en: 'Custom', defaultMood: ['warm'] },
};

/**
 * Data classification drives retention + logging + encryption scope.
 *  personal_basic   : store encrypted, usable in lyrics
 *  personal_sensitive: store encrypted, needs explicit inclusion consent
 *  never_store      : used in-session for generation only, never persisted
 */
export const CLASSIFICATIONS = {
  personal_basic: { retentionDays: 365, log: 'redacted', label: { ko: '일반 개인정보', en: 'Basic personal' } },
  personal_sensitive: { retentionDays: 180, log: 'never', label: { ko: '민감 정보', en: 'Sensitive' } },
  never_store: { retentionDays: 0, log: 'never', label: { ko: '저장 안 함', en: 'Never stored' } },
};

export const QUESTIONS = [
  {
    id: 'recipient',
    label: { ko: '이 노래는 누구를 위한 곡인가요?', en: 'Who is this song for?' },
    placeholder: { ko: '예: 아내 미나 (곡에 넣을 호칭)', en: 'e.g. my wife Mina' },
    required: true,
    classification: 'personal_basic',
    maxLen: 40,
  },
  {
    id: 'relationship',
    label: { ko: '어떤 관계인가요?', en: 'What is your relationship?' },
    placeholder: { ko: '예: 10년째 함께인 배우자', en: 'e.g. married 10 years' },
    required: true,
    classification: 'personal_basic',
    maxLen: 80,
  },
  {
    id: 'memory',
    label: { ko: '반드시 담고 싶은 기억은 무엇인가요?', en: 'Which memory must be included?' },
    placeholder: { ko: '예: 첫 겨울에 버스를 놓치고 한 시간을 걸었던 밤', en: 'e.g. the night we missed the bus and walked an hour' },
    required: true,
    classification: 'personal_basic',
    multiline: true,
    maxLen: 400,
  },
  {
    id: 'feeling',
    label: { ko: '듣는 사람이 어떤 감정을 느끼길 원하나요?', en: 'What should the listener feel?' },
    placeholder: { ko: '예: 고맙고, 조금 울컥하고, 결국 웃게 되는', en: 'e.g. grateful, a little teary, then smiling' },
    required: true,
    classification: 'personal_basic',
    maxLen: 120,
  },
  {
    id: 'details',
    label: { ko: '넣고 싶은 이름 · 날짜 · 장소가 있나요?', en: 'Names, dates or places to include?' },
    placeholder: { ko: '예: 2016년 3월, 연희동', en: 'e.g. March 2016, Yeonhui-dong' },
    required: false,
    classification: 'personal_sensitive',
    maxLen: 120,
  },
  {
    id: 'exclude',
    label: { ko: '절대 넣지 말아야 할 내용이 있나요?', en: 'Anything that must never appear?' },
    placeholder: { ko: '예: 병원 이야기, 전 직장 이름', en: 'e.g. the hospital, my old employer' },
    required: false,
    classification: 'never_store',
    maxLen: 200,
  },
  {
    id: 'avoidTone',
    label: { ko: '피하고 싶은 분위기가 있나요?', en: 'Any tone to avoid?' },
    placeholder: { ko: '예: 너무 슬프거나 장난스러운 느낌', en: 'e.g. too sad, or joking' },
    required: false,
    classification: 'personal_basic',
    maxLen: 120,
  },
];

const PII_PATTERNS = [
  { id: 'phone', re: /(\+?\d{2,3}[-\s]?)?0?1\d[-\s]?\d{3,4}[-\s]?\d{4}/g, severity: 'high', label: { ko: '전화번호', en: 'Phone number' } },
  { id: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g, severity: 'high', label: { ko: '이메일', en: 'Email' } },
  { id: 'rrn', re: /\d{6}[-\s]?\d{7}/g, severity: 'critical', label: { ko: '주민등록번호 형식', en: 'National ID pattern' } },
  { id: 'card', re: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, severity: 'critical', label: { ko: '카드번호 형식', en: 'Card number pattern' } },
  { id: 'address', re: /[가-힣]+(시|도)\s?[가-힣]+(구|군|시)\s?[가-힣0-9-]+(동|로|길)\s?\d*/g, severity: 'medium', label: { ko: '상세 주소', en: 'Street address' } },
  { id: 'fulldate', re: /(19|20)\d{2}[.\-/년]\s?\d{1,2}[.\-/월]\s?\d{1,2}\s?일?/g, severity: 'low', label: { ko: '전체 날짜', en: 'Full date' } },
  { id: 'health', re: /(암|수술|입원|항암|우울증|치료|병원|진단|중환자|호스피스)/g, severity: 'high', label: { ko: '건강 관련', en: 'Health reference' } },
  { id: 'workplace', re: /(주식회사|㈜|Inc\.|Corp\.|LLC)/g, severity: 'low', label: { ko: '회사명', en: 'Company name' } },
];

/** Scan free text for details that must be flagged before lyric generation. */
export function scanSensitive(text) {
  if (!text) return [];
  const found = [];
  for (const p of PII_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      found.push({ type: p.id, severity: p.severity, label: p.label, match: m[0], index: m.index });
      if (!re.global) break;
    }
  }
  return found;
}

export function redact(text) {
  let out = text || '';
  for (const p of PII_PATTERNS) {
    out = out.replace(new RegExp(p.re.source, p.re.flags), `[${p.id}]`);
  }
  return out;
}

/**
 * Build the StoryBrief. Fields classified never_store are kept on a separate
 * `ephemeral` object so persistence code can drop them in one place.
 */
export function buildBrief({ occasion, occasionCustom, answers, locale = 'ko', privacyMode = 'private' }) {
  const facts = [];
  const ephemeral = {};
  const flags = [];

  for (const q of QUESTIONS) {
    const raw = (answers[q.id] || '').trim();
    if (!raw) continue;
    const value = raw.slice(0, q.maxLen);
    const hits = scanSensitive(value);
    hits.forEach((h) => flags.push({ ...h, field: q.id }));
    if (q.classification === 'never_store') {
      ephemeral[q.id] = value;
    } else {
      facts.push({
        id: q.id,
        label: q.label[locale] || q.label.ko,
        value,
        classification: q.classification,
        includeInLyrics: q.id !== 'avoidTone' && q.id !== 'exclude',
      });
    }
  }

  const prohibited = splitList(answers.exclude || '');
  const avoidTone = splitList(answers.avoidTone || '');

  return {
    version: 1,
    occasion,
    occasionLabel: occasion === 'custom' ? (occasionCustom || 'Custom') : (OCCASIONS[occasion]?.[locale] || occasion),
    recipientAlias: aliasFor(answers.recipient || ''),
    approvedFacts: facts,
    prohibitedDetails: prohibited,
    avoidTone,
    sensitiveFlags: flags,
    ephemeral,
    privacyMode,
    locale,
    approvedAt: null,
    createdAt: new Date().toISOString(),
  };
}

/** Recipient is stored as an alias; the raw string stays in the fact list only. */
function aliasFor(recipient) {
  const name = recipient.replace(/(에게|님|씨|to\s+)/gi, '').trim().split(/\s+/).pop() || 'recipient';
  return name.slice(0, 12);
}

function splitList(s) {
  return s
    .split(/[,、·\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function briefSummary(brief, locale = 'ko') {
  const get = (id) => brief.approvedFacts.find((f) => f.id === id)?.value || '';
  if (locale === 'en') {
    return [
      `Occasion: ${brief.occasionLabel}`,
      `For: ${get('recipient')} (${get('relationship')})`,
      `Memory: ${get('memory')}`,
      `Intended feeling: ${get('feeling')}`,
      get('details') ? `Include: ${get('details')}` : null,
      brief.prohibitedDetails.length ? `Never mention: ${brief.prohibitedDetails.join(', ')}` : null,
      brief.avoidTone.length ? `Avoid tone: ${brief.avoidTone.join(', ')}` : null,
    ].filter(Boolean).join('\n');
  }
  return [
    `상황: ${brief.occasionLabel}`,
    `대상: ${get('recipient')} (${get('relationship')})`,
    `담을 기억: ${get('memory')}`,
    `전하고 싶은 감정: ${get('feeling')}`,
    get('details') ? `포함할 디테일: ${get('details')}` : null,
    brief.prohibitedDetails.length ? `절대 언급 금지: ${brief.prohibitedDetails.join(', ')}` : null,
    brief.avoidTone.length ? `피할 분위기: ${brief.avoidTone.join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

/** What actually gets written to storage under each privacy mode. */
export function persistable(brief) {
  const copy = JSON.parse(JSON.stringify(brief));
  delete copy.ephemeral;
  if (brief.privacyMode === 'strict') {
    copy.approvedFacts = copy.approvedFacts.map((f) =>
      f.classification === 'personal_sensitive' ? { ...f, value: '[not stored]', omitted: true } : f,
    );
  }
  return copy;
}
