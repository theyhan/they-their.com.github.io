/**
 * dna-page.js — Music DNA dashboard (PRD §9.6).
 *
 * Requirements made visible: explicit vs inferred, a confidence number on every
 * inference, the signals behind it, per-signal deletion, exclusions, consent,
 * export and full reset.
 */

import { el, $, clear, download, toast, confirmDialog } from './ui/dom.js';
import * as store from './core/store.js';
import * as DNA from './domain/dna.js';

function profile() {
  const s = store.load();
  if (!s.profile) store.update((st) => { st.profile = DNA.emptyProfile('ko'); });
  return store.load().profile;
}

function setProfile(next) {
  store.update((st) => { st.profile = next; });
  render();
}

function render() {
  const host = clear($('#dnaBody'));
  const p = profile();
  const { resolved, inferred } = DNA.resolveProfile(p);

  // effective profile
  const eff = el('div', { class: 'panel' }, el('div', { class: 'panel-h' }, '적용 중인 취향'));
  for (const [dim, def] of Object.entries(DNA.DIMENSIONS)) {
    const r = resolved[dim];
    const label = (v) => (Array.isArray(v) ? v : [v]).map((x) => def.options[x]?.ko || x).join(', ');
    eff.append(
      el(
        'div',
        { class: 'dna-dim' },
        el('div', { class: 'name' }, def.label.ko),
        el(
          'div',
          { class: 'val' },
          label(r.value),
          r.source === 'inferred' && inferred[dim]?.competing?.length
            ? el('div', { class: 'tiny dim' }, '경합: ' + inferred[dim].competing.map((c) => (def.options[c.value]?.ko || c.value)).join(', '))
            : null,
          inferred[dim]?.negative?.length
            ? el('div', { class: 'tiny dim' }, '부정 신호: ' + inferred[dim].negative.map((c) => def.options[c.value]?.ko || c.value).join(', '))
            : null,
        ),
        el(
          'div',
          { class: 'conf' },
          r.source === 'explicit'
            ? el('span', { class: 'badge badge-ok' }, '직접 선택')
            : r.source === 'inferred'
              ? el('span', { class: 'badge badge-info' }, `추론 ${Math.round(r.confidence * 100)}%`)
              : el('span', { class: 'badge' }, '기본값'),
          r.source === 'inferred' ? el('span', { class: 'bar' }, el('i', { style: `width:${Math.round(r.confidence * 100)}%` })) : null,
          r.source !== 'default'
            ? el('button', {
                class: 'btn btn-sm btn-ghost',
                title: '이 항목을 기본값으로 되돌립니다',
                onclick: () => {
                  setProfile(DNA.setExplicit(p, dim, null));
                  toast('직접 선택을 해제했습니다.', 'ok');
                },
              }, '해제')
            : null,
        ),
      ),
    );
  }
  host.append(eff);

  // inferred detail
  const inf = el('div', { class: 'panel' }, el('div', { class: 'panel-h' }, '추론된 값 (적용 여부와 별개로 전부 공개)'));
  const rows = Object.entries(inferred);
  if (!rows.length) inf.append(el('p', { class: 'small dim' }, '아직 추론할 신호가 없습니다. 스튜디오에서 샘플을 비교해 보세요.'));
  for (const [dim, v] of rows) {
    const def = DNA.DIMENSIONS[dim];
    const applied = resolved[dim].source === 'inferred';
    inf.append(
      el(
        'div',
        { class: 'dna-dim' },
        el('div', { class: 'name' }, def.label.ko),
        el('div', { class: 'val' },
          (Array.isArray(v.value) ? v.value : [v.value]).map((x) => def.options[x]?.ko || x).join(', '),
          el('span', { class: 'tiny dim' }, ` · 신호 ${v.support}건`)),
        el('div', { class: 'conf' },
          el('span', { class: 'bar' }, el('i', { style: `width:${Math.round(v.confidence * 100)}%` })),
          el('span', { class: 'tiny' }, `${Math.round(v.confidence * 100)}%`),
          el('span', { class: 'badge ' + (applied ? 'badge-info' : '') }, applied ? '적용됨' : '미적용')),
      ),
    );
  }
  inf.append(el('p', { class: 'tiny dim', style: 'margin-top:10px' },
    `확신도 ${Math.round(DNA.INFER_THRESHOLD * 100)}% 이상일 때만 적용합니다. 신호가 1건이면 아무리 강해도 적용하지 않고, 90일 반감기로 감쇠합니다.`));
  host.append(inf);

  // exclusions
  const exWrap = el('div', { class: 'panel' }, el('div', { class: 'panel-h' }, '제외 항목 (하드 필터)'));
  const chips = el('div', { class: 'chips' });
  for (const [optId, optLabel] of Object.entries(DNA.DIMENSIONS.instrumentation.options)) {
    const on = (p.exclusions.instruments || []).includes(optId);
    chips.append(el('button', {
      class: 'chip excl', 'aria-pressed': String(on),
      onclick: () => setProfile(on
        ? DNA.removeExclusion(p, 'instruments', optId)
        : DNA.addExclusion(p, 'instruments', optId)),
    }, optLabel.ko));
  }
  exWrap.append(chips, el('p', { class: 'tiny dim', style: 'margin-top:8px' }, '제외 항목은 추론보다 항상 우선합니다.'));
  host.append(exWrap);

  // consent
  const consent = el('div', { class: 'panel' }, el('div', { class: 'panel-h' }, '동의 설정'));
  for (const [key, label, desc] of [
    ['behavioralLearning', '행동 기반 학습 사용', '재생 · 건너뜀 · 다운로드 같은 행동을 취향 추론에 사용합니다.'],
    ['referenceUpload', '참고 음원 업로드 사용', '권리를 확인한 참고 음원만 업로드할 수 있습니다.'],
  ]) {
    consent.append(
      el('div', { class: 'spread', style: 'padding:8px 0;border-bottom:1px solid var(--line)' },
        el('div', {}, el('div', {}, label), el('div', { class: 'tiny dim' }, desc)),
        el('button', {
          class: 'chip', 'aria-pressed': String(!!p.consent[key]),
          onclick: () => {
            const next = JSON.parse(JSON.stringify(p));
            next.consent[key] = !next.consent[key];
            next.version++;
            setProfile(next);
          },
        }, p.consent[key] ? '켜짐' : '꺼짐')),
    );
  }
  consent.append(el('p', { class: 'tiny dim', style: 'margin-top:8px' }, `동의 버전 ${p.consent.consentVersion}`));
  host.append(consent);

  // signals
  const sig = el('div', { class: 'panel' },
    el('div', { class: 'spread' },
      el('div', { class: 'panel-h', style: 'margin:0' }, `신호 기록 (${p.signals.length})`),
      el('button', {
        class: 'btn btn-sm btn-ghost',
        disabled: !p.signals.length,
        onclick: async () => {
          if (await confirmDialog('모든 신호를 삭제합니다. 직접 선택한 값은 남습니다.', { confirmText: '삭제' })) {
            const next = JSON.parse(JSON.stringify(p));
            next.signals = [];
            next.version++;
            setProfile(next);
            store.emit('dna_signal_deleted', { all: true });
          }
        },
      }, '신호 전체 삭제')));
  if (!p.signals.length) sig.append(el('p', { class: 'small dim' }, '기록된 신호가 없습니다.'));
  for (const s of [...p.signals].reverse().slice(0, 40)) {
    const def = DNA.DIMENSIONS[s.dimension];
    sig.append(
      el('div', { class: 'sig-row' },
        el('span', { class: 'src' }, DNA.SIGNAL_SOURCES[s.source]?.label.ko || s.source),
        el('span', { class: 'grow' }, `${def?.label.ko || s.dimension}: ${def?.options[s.value]?.ko || s.value}`),
        el('span', { class: 'w' }, `w=${s.weight}`),
        el('span', { class: 'w' }, s.createdAt.slice(5, 16).replace('T', ' ')),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => { setProfile(DNA.deleteSignal(p, s.id)); store.emit('dna_signal_deleted', { signalId: s.id }); },
        }, '삭제')),
    );
  }
  host.append(sig);

  // export / reset
  host.append(
    el('div', { class: 'panel row-wrap' },
      el('button', {
        class: 'btn',
        onclick: () => {
          download(new Blob([DNA.exportProfile(p)], { type: 'application/json' }), 'music-dna.json');
          toast('Music DNA를 내보냈습니다.', 'ok');
        },
      }, 'JSON으로 내보내기'),
      el('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          if (await confirmDialog('Music DNA를 완전히 초기화합니다. 직접 선택 · 신호 · 제외 항목이 모두 사라집니다.', { confirmText: '초기화' })) {
            setProfile(DNA.emptyProfile('ko'));
            store.emit('dna_reset', {});
            toast('초기화했습니다.', 'ok');
          }
        },
      }, '전체 초기화'),
      el('span', { class: 'tiny dim' }, `프로필 버전 ${p.version} · 최근 변경 ${p.updatedAt.slice(0, 16).replace('T', ' ')}`)),
  );
}

render();
