/**
 * lyrics.js — deterministic, template-driven lyric drafting + editing model.
 *
 * This is *not* a language model. It is a stand-in that produces a structurally
 * valid, story-anchored draft so the whole editorial workflow (line locking,
 * sensitive-detail flagging, prohibited-detail enforcement, coverage scoring,
 * edit-distance measurement, section regeneration) can be built and tested
 * before a TextModelAdapter is wired in. Every rule enforced here is a rule a
 * real Lyric Agent + Lyric Reviewer must also satisfy.
 */

import { mulberry32, seedFrom } from '../audio/theory.js';

export const SECTION_PLAN = [
  { kind: 'verse', index: 1, lines: 4 },
  { kind: 'prechorus', index: 1, lines: 2 },
  { kind: 'chorus', index: 1, lines: 4 },
  { kind: 'verse', index: 2, lines: 4 },
  { kind: 'bridge', index: 1, lines: 2 },
];

const BANK = {
  ko: {
    verse: {
      anniversary: [
        '{name}, 오늘도 같은 자리에 있어줘서',
        '고맙다는 말은 늘 한 걸음 늦었어',
        '우리 지나온 계절을 세어보다가',
        '그냥 웃음이 나더라',
        '아무 일 없던 하루가 제일 좋았어',
        '평범한 저녁이 우리를 키웠지',
      ],
      birthday: [
        '{name}, 오늘은 네가 주인공이야',
        '작게 켠 촛불 하나에 웃음이 번지고',
        '네가 태어난 계절이 다시 돌아왔어',
        '올해도 네 이름을 부를 수 있어서 좋아',
        '무슨 소원을 빌었는지 안 물어볼게',
      ],
      wedding: [
        '{name}, 오래 걸어온 길 끝에 네가 있어',
        '이제 우리는 같은 이름으로 불릴 거야',
        '떨리는 손을 잡고 천천히 걸어갈게',
        '첫 문장을 다시 쓰는 기분이야',
      ],
      family: [
        '{name}, 그 시절 당신은 늘 뒤에 서 있었지',
        '내가 앞만 보고 걷던 날에도',
        '이제야 그 등이 얼마나 넓었는지 알아',
        '고맙다는 말을 너무 오래 아꼈어',
      ],
      friendship: [
        '{name}, 우리가 처음 만났던 날 기억나?',
        '별거 없는 얘기로 밤을 다 썼지',
        '멀어졌다 싶으면 늘 다시 왔고',
        '그게 우리 방식이었어',
      ],
      memorial: [
        '{name}, 오늘은 당신 얘기를 하고 싶어',
        '아직 그 목소리가 이 방에 남아 있어',
        '슬픔보다 먼저 고마움이 왔어',
        '잘 지낸다는 말을 전하고 싶었어',
      ],
      theme: [
        '오늘의 나는 어제보다 조금 낫고',
        '넘어진 자리를 이제는 알아',
        '내 속도로 걸어갈게',
        '그게 나쁘지 않다는 걸 배웠어',
      ],
      custom: [
        '이 노래는 너에게 하는 말이야',
        '길게 설명하지 않아도 알 거라 믿어',
        '오늘의 마음을 여기 남겨둘게',
        '천천히 들어줘',
      ],
    },
    prechorus: [
      '그래서 오늘은,',
      '이 말을 꼭 하고 싶었어',
      '준비한 말은 많았는데',
      '결국 남은 건 한 문장이야',
    ],
    chorus: {
      default: [
        '{name}, 네가 있어서 나는 나야',
        '이 노래를 다 들으면 알 거야',
        '고마워, 라는 말로는 조금 부족해서',
        '오래 남을 만한 걸 만들었어',
        '{name}, 우리 계속 여기 있자',
        '아주 오래 이 노래처럼',
      ],
      memorial: [
        '{name}, 당신은 아직 여기 있어',
        '이 노래가 계속 이름을 부를 거야',
        '보고 싶다는 말을 이렇게 남길게',
        '잊지 않았다고, 그거면 됐지',
      ],
      theme: [
        '나는 나를 데리고 계속 걸어갈 거야',
        '멀리 못 가도 괜찮아',
        '이 리듬이 내 속도야',
        '오늘도 여기서 다시 시작해',
      ],
    },
    bridge: [
      '언젠가 이 노래가 낡아도',
      '그날의 우리는 그대로일 거야',
      '조금 더 크게 불러볼게',
      '너에게 닿을 만큼',
    ],
  },
  en: {
    verse: {
      default: [
        '{name}, you were there again today',
        'and I never said it right',
        'I counted all the seasons we walked through',
        'and I just started smiling',
        'the quiet days were always the best ones',
      ],
      birthday: [
        '{name}, today the room is yours',
        'one small candle and the whole year turns',
        'the season you were born in came back around',
        'I get to say your name again',
      ],
      memorial: [
        '{name}, I want to talk about you today',
        'your voice is still somewhere in this room',
        'gratitude got here before the grief did',
        'I wanted you to know we are alright',
      ],
    },
    prechorus: [
      'so here it is,',
      'the one thing I wanted to say',
      'I had a hundred lines',
      'and only one of them was true',
    ],
    chorus: {
      default: [
        '{name}, I am who I am because you stayed',
        'you will know it by the end of this song',
        'thank you never sounded big enough',
        'so I built something that lasts',
      ],
      memorial: [
        '{name}, you are still here in this',
        'this song will keep on saying your name',
        'this is how I say I miss you',
        'and that we did not forget',
      ],
    },
    bridge: [
      'and when this song gets old',
      'that day will still be ours',
      'I will sing it louder',
      'loud enough to reach you',
    ],
  },
  ja: {
    verse: {
      default: [
        '{name}、今日もそこにいてくれて',
        'ありがとうは いつも遅れて届く',
        '過ぎた季節を 数えてみたら',
        'なぜだか 笑えてきたよ',
      ],
    },
    prechorus: ['だから今日は', '伝えたいことがある'],
    chorus: {
      default: [
        '{name}、きみがいるから 僕は僕だよ',
        'この歌の終わりに わかるはず',
        'ありがとうじゃ 足りないから',
        '長く残るものを作ったよ',
      ],
    },
    bridge: ['この歌が古くなっても', 'あの日の僕らはそのまま'],
  },
};

/* ------------------------- syllable counting ------------------------- */

export function countSyllables(text, lang = 'ko') {
  if (!text) return 0;
  const t = text.trim();
  if (lang === 'ko') {
    const hangul = (t.match(/[\uAC00-\uD7A3]/g) || []).length;
    const latin = latinSyllables(t.replace(/[\uAC00-\uD7A3]/g, ' '));
    const digits = (t.match(/\d/g) || []).length;
    return Math.max(1, hangul + latin + digits);
  }
  if (lang === 'ja') {
    const kana = (t.match(/[\u3041-\u3096\u30A1-\u30FA\u4E00-\u9FFF]/g) || []).length;
    const small = (t.match(/[\u3083\u3085\u3087\u30A3\u30E3\u30E5\u30E7]/g) || []).length;
    return Math.max(1, kana - small + latinSyllables(t.replace(/[^\x00-\x7F]/g, ' ')));
  }
  return Math.max(1, latinSyllables(t));
}

function latinSyllables(s) {
  const words = s.toLowerCase().match(/[a-z']+/g) || [];
  let total = 0;
  for (const w of words) {
    const groups = w.replace(/e\b/, '').match(/[aeiouy]+/g);
    total += Math.max(1, groups ? groups.length : 1);
  }
  return total;
}

/* ------------------------- generation ------------------------- */

function pickBank(lang, kind, occasion) {
  const langBank = BANK[lang] || BANK.ko;
  const node = langBank[kind];
  if (Array.isArray(node)) return node;
  return node[occasion] || node.default || Object.values(node)[0];
}

/** Break the user's memory text into short singable fragments. */
export function memoryFragments(memory, lang = 'ko') {
  if (!memory) return [];
  return memory
    .split(/[,.;·\n。！!?？]|그리고|그때|그래서|and then|and /)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && countSyllables(s, lang) <= 22)
    .slice(0, 4);
}

let lineCounter = 0;
function makeLine(text, lang, origin = 'generated') {
  const clean = text.replace(/\s+/g, ' ').trim();
  return {
    id: `L${(++lineCounter).toString(36)}`,
    text: clean,
    generatedText: clean,
    locked: false,
    origin,
    syllables: countSyllables(clean, lang),
  };
}

/**
 * @param {object} brief StoryBrief
 * @param {object} opts {lang, seed, occasion}
 */
export function generateLyrics(brief, opts = {}) {
  const lang = opts.lang || (brief.locale === 'en' ? 'en' : 'ko');
  const seed = opts.seed ?? seedFrom(JSON.stringify(brief.approvedFacts) + lang);
  const rng = mulberry32(seed);
  const name = brief.recipientAlias || (lang === 'ko' ? '너' : 'you');
  const occasion = brief.occasion || 'custom';
  const memory = brief.approvedFacts.find((f) => f.id === 'memory')?.value || '';
  const details = brief.approvedFacts.find((f) => f.id === 'details')?.value || '';
  const frags = memoryFragments(memory, lang);

  const sections = SECTION_PLAN.map((plan) => {
    const bank = pickBank(lang, plan.kind, occasion).slice();
    shuffle(bank, rng);
    const lines = [];
    // Verse 1 anchors the user's own memory wording; verse 2 uses the rest.
    const fragPool = plan.kind === 'verse' && plan.index === 1 ? frags.slice(0, 2) : frags.slice(2);
    let fi = 0;
    for (let i = 0; i < plan.lines; i++) {
      const useFrag = fragPool[fi] && (i === 1 || i === 2) ;
      let text;
      if (useFrag) {
        text = fragPool[fi++];
      } else {
        text = bank[i % bank.length] || bank[0];
      }
      lines.push(makeLine(text.replace(/\{name\}/g, name), lang, useFrag ? 'story' : 'generated'));
    }
    if (plan.kind === 'verse' && plan.index === 2 && details) {
      lines[lines.length - 1] = makeLine(details, lang, 'story');
    }
    return { kind: plan.kind, index: plan.index, lines };
  });

  const alternatives = buildChorusAlternatives(lang, occasion, name, rng);

  return {
    version: 1,
    language: lang,
    seed,
    sections,
    chorusAlternatives: alternatives,
    approvedAt: null,
    createdAt: new Date().toISOString(),
  };
}

function buildChorusAlternatives(lang, occasion, name, rng) {
  const bank = pickBank(lang, 'chorus', occasion).slice();
  const alts = [];
  for (let a = 0; a < 2; a++) {
    shuffle(bank, rng);
    alts.push({
      id: `alt${a + 1}`,
      lines: bank.slice(0, 4).map((t) => t.replace(/\{name\}/g, name)),
    });
  }
  return alts;
}

export function regenerateSection(lyrics, brief, kind, index, extraSeed = 0) {
  const next = clone(lyrics);
  const target = next.sections.find((s) => s.kind === kind && s.index === index);
  if (!target) return next;
  const lang = next.language;
  const name = brief.recipientAlias || (lang === 'ko' ? '너' : 'you');
  const rng = mulberry32(seedFrom(`${next.seed}|${kind}${index}|${extraSeed || Date.now()}`));
  const bank = pickBank(lang, kind, brief.occasion || 'custom').slice();
  shuffle(bank, rng);
  target.lines = target.lines.map((line, i) => {
    if (line.locked) return line; // locked lines are never overwritten
    return makeLine((bank[i % bank.length] || bank[0]).replace(/\{name\}/g, name), lang);
  });
  next.version++;
  return next;
}

export function editLine(lyrics, lineId, text) {
  const next = clone(lyrics);
  for (const s of next.sections) {
    const line = s.lines.find((l) => l.id === lineId);
    if (line) {
      line.text = text;
      line.origin = 'edited';
      line.syllables = countSyllables(text, next.language);
      next.version++;
      return next;
    }
  }
  return next;
}

export function toggleLock(lyrics, lineId) {
  const next = clone(lyrics);
  for (const s of next.sections) {
    const line = s.lines.find((l) => l.id === lineId);
    if (line) {
      line.locked = !line.locked;
      next.version++;
      return next;
    }
  }
  return next;
}

export function applyChorusAlternative(lyrics, altId) {
  const next = clone(lyrics);
  const alt = next.chorusAlternatives.find((a) => a.id === altId);
  const chorus = next.sections.find((s) => s.kind === 'chorus' && s.index === 1);
  if (!alt || !chorus) return next;
  chorus.lines = chorus.lines.map((line, i) =>
    line.locked ? line : makeLine(alt.lines[i] || line.text, next.language),
  );
  next.version++;
  return next;
}

/* ------------------------- review / QA ------------------------- */

export function allLines(lyrics) {
  return lyrics.sections.flatMap((s) => s.lines.map((l) => ({ ...l, kind: s.kind, index: s.index })));
}

export function plainText(lyrics, locale = 'ko') {
  const LBL = {
    verse: locale === 'en' ? 'Verse' : '벌스',
    prechorus: locale === 'en' ? 'Pre-chorus' : '프리코러스',
    chorus: locale === 'en' ? 'Chorus' : '후렴',
    bridge: locale === 'en' ? 'Bridge' : '브릿지',
  };
  return lyrics.sections
    .map((s) => `[${LBL[s.kind] || s.kind} ${s.index}]\n` + s.lines.map((l) => l.text).join('\n'))
    .join('\n\n');
}

/** Story fidelity: how much of the user's own wording survived into the lyric. */
export function storyCoverage(lyrics, brief) {
  const text = allLines(lyrics).map((l) => l.text).join(' ');
  const results = [];
  for (const fact of brief.approvedFacts) {
    if (!fact.includeInLyrics) continue;
    const tokens = tokenize(fact.value).filter((t) => t.length >= 2);
    if (!tokens.length) continue;
    const hit = tokens.filter((t) => text.includes(t));
    results.push({
      factId: fact.id,
      label: fact.label,
      coverage: +(hit.length / tokens.length).toFixed(2),
      matched: hit.slice(0, 6),
    });
  }
  const overall = results.length
    ? +(results.reduce((a, r) => a + r.coverage, 0) / results.length).toFixed(2)
    : 0;
  return { overall, perFact: results };
}

function tokenize(s) {
  return (s.match(/[\uAC00-\uD7A3]{2,}|[A-Za-z]{3,}|\d{2,}/g) || []).map((x) => x.trim());
}

/** Prohibited-detail enforcement + sensitive flagging over the *lyrics*. */
export function reviewLyrics(lyrics, brief) {
  const lines = allLines(lyrics);
  const violations = [];
  const flagged = [];
  for (const line of lines) {
    for (const banned of brief.prohibitedDetails || []) {
      if (!banned) continue;
      if (line.text.toLowerCase().includes(banned.toLowerCase())) {
        violations.push({ lineId: line.id, banned, text: line.text });
      }
    }
    if (/\d{4,}/.test(line.text)) {
      flagged.push({ lineId: line.id, reason: 'number', text: line.text });
    }
    if (brief.approvedFacts.some((f) => f.classification === 'personal_sensitive' && f.value && line.text.includes(f.value))) {
      flagged.push({ lineId: line.id, reason: 'sensitive_detail', text: line.text });
    }
  }
  const empties = lines.filter((l) => !l.text.trim()).length;
  const tooLong = lines.filter((l) => l.syllables > 24).map((l) => l.id);
  return {
    canApprove: violations.length === 0 && empties === 0,
    violations,
    flagged,
    warnings: [
      ...(tooLong.length ? [{ code: 'line_too_long', lineIds: tooLong }] : []),
      ...(empties ? [{ code: 'empty_line', count: empties }] : []),
    ],
    coverage: storyCoverage(lyrics, brief),
    editDistance: editDistanceStats(lyrics),
  };
}

/** KPI: "lyric edit distance before approval". */
export function editDistanceStats(lyrics) {
  const lines = allLines(lyrics);
  let dist = 0;
  let len = 0;
  let editedLines = 0;
  for (const l of lines) {
    const d = levenshtein(l.generatedText || '', l.text || '');
    dist += d;
    len += Math.max(1, (l.generatedText || '').length);
    if (d > 0) editedLines++;
  }
  return { totalDistance: dist, normalized: +(dist / len).toFixed(3), editedLines, totalLines: lines.length };
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Language adaptation: keeps the section shape, swaps the wording bank. */
export function adaptLanguage(lyrics, brief, targetLang) {
  const next = generateLyrics(brief, { lang: targetLang, seed: lyrics.seed });
  next.version = lyrics.version + 1;
  next.adaptedFrom = lyrics.language;
  next.note = 'adaptation: melody preserved, wording regenerated in target language';
  return next;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
