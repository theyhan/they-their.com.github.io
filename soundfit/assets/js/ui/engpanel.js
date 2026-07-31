/**
 * engpanel.js — operator/engineering drawer.
 *
 * Everything the PRD requires operationally but never shows anyone: state
 * machine history, the event stream with its KPI mapping, the cost ledger, the
 * provider capability matrix, the audit log and the idempotency ledger.
 * Having it visible in the prototype is how you find out the taxonomy is wrong
 * before analytics is wired up.
 */

import { el, clear, $ } from './dom.js';
import * as store from '../core/store.js';
import { capabilityMatrix, ACTIVE_ADAPTERS, REGISTRY_VERSION, readinessGate } from '../domain/capability.js';

const TABS = [
  ['state', '상태 / State'],
  ['events', '이벤트 / KPI'],
  ['cost', '비용 원장'],
  ['capability', '프로바이더'],
  ['audit', '감사 로그'],
  ['idem', '멱등성'],
];

let active = 'state';

export function mountEngPanel() {
  const drawer = el('aside', { class: 'drawer', id: 'engDrawer', 'aria-hidden': 'true' });
  const body = el('div', { class: 'body', id: 'engBody' });
  drawer.append(
    el(
      'header',
      {},
      el('strong', {}, '엔지니어링 패널'),
      el('span', { class: 'badge badge-info' }, 'prototype'),
      el('div', { class: 'grow' }),
      el('button', { class: 'btn btn-sm', onclick: () => toggleEngPanel(false) }, '닫기'),
    ),
    body,
  );
  document.body.append(drawer);
  document.body.append(
    el(
      'button',
      { class: 'btn btn-sm eng-toggle', onclick: () => toggleEngPanel(), title: '운영 지표 보기' },
      '⚙︎ 엔지니어링 패널',
    ),
  );
  store.subscribe(() => {
    if (drawer.classList.contains('open')) renderEng();
  });
}

export function toggleEngPanel(force) {
  const d = $('#engDrawer');
  const open = force === undefined ? !d.classList.contains('open') : force;
  d.classList.toggle('open', open);
  d.setAttribute('aria-hidden', String(!open));
  if (open) renderEng();
}

export function renderEng() {
  const body = $('#engBody');
  if (!body) return;
  clear(body);
  body.append(
    el(
      'div',
      { class: 'tabs' },
      TABS.map(([id, label]) =>
        el('button', { class: active === id ? 'on' : '', onclick: () => { active = id; renderEng(); } }, label),
      ),
    ),
  );
  const s = store.get();
  const p = store.currentProject();
  if (active === 'state') body.append(stateView(p));
  if (active === 'events') body.append(eventsView(s));
  if (active === 'cost') body.append(costView(p));
  if (active === 'capability') body.append(capabilityView());
  if (active === 'audit') body.append(auditView(s));
  if (active === 'idem') body.append(idemView(s));
}

function table(headers, rows) {
  return el(
    'table',
    {},
    el('thead', {}, el('tr', {}, headers.map((h) => el('th', {}, h)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, String(c ?? '')))))),
  );
}

function stateView(p) {
  if (!p) return el('p', { class: 'muted' }, '진행 중인 프로젝트가 없습니다.');
  const kpi = store.kpiSnapshot();
  return el(
    'div',
    { class: 'stack' },
    el('div', { class: 'panel-h' }, '현재 상태'),
    el('p', {}, el('span', { class: 'badge badge-info' }, p.status), ' ', el('span', { class: 'mono' }, p.id)),
    el('div', { class: 'panel-h' }, '허용된 다음 상태'),
    el('p', { class: 'mono' }, (store.STATES[p.status] || []).join(' · ') || '(terminal)'),
    el('div', { class: 'panel-h' }, '상태 전이 기록'),
    table(['state', 'at'], p.stateHistory.map((h) => [h.state, h.at.slice(11, 19)])),
    el('div', { class: 'panel-h' }, '엔타이틀먼트'),
    table(
      ['field', 'value'],
      [
        ['paid', p.entitlement.paid],
        ['orderId', p.entitlement.orderId || '-'],
        ['includedRevisions', p.entitlement.includedRevisions],
        ['usedRevisions', p.entitlement.usedRevisions],
      ],
    ),
    el('div', { class: 'panel-h' }, 'KPI 스냅샷 (로컬)'),
    table(['kpi', 'value'], Object.entries(kpi).map(([k, v]) => [k, typeof v === 'object' && v ? JSON.stringify(v) : v])),
  );
}

function eventsView(s) {
  const rows = s.events.slice(-70).reverse().map((e) => [
    e.at.slice(11, 19),
    e.name,
    (e.kpi || []).join(','),
    JSON.stringify(e.props).slice(0, 90),
  ]);
  return el(
    'div',
    { class: 'stack' },
    el('p', { class: 'small muted' }, '모든 이벤트는 KPI에 매핑되고, 문자열 속성은 PII 리댁션을 통과합니다.'),
    table(['t', 'event', 'kpi', 'props'], rows),
  );
}

function costView(p) {
  if (!p) return el('p', { class: 'muted' }, '프로젝트 없음');
  const c = store.projectCost(p.id);
  return el(
    'div',
    { class: 'stack' },
    el('p', {}, `총 ${c.totalUsd} USD · ${c.totalMs} ms`),
    el('p', { class: 'small muted' }, '로컬 엔진 단가는 0이지만, 스테이지별 작업량과 소요 시간을 기록해 두면 유료 프로바이더로 전환할 때 마진 계산이 바로 됩니다.'),
    table(
      ['stage', 'provider', 'units', 'ms', 'usd'],
      c.rows.map((r) => [r.stage, r.provider, r.units, r.ms ?? '-', r.costUsd]),
    ),
  );
}

function capabilityView() {
  const m = capabilityMatrix();
  return el(
    'div',
    { class: 'stack' },
    el('p', { class: 'small muted' }, `capability registry ${REGISTRY_VERSION} — 비즈니스 로직은 이 표만 참조합니다.`),
    table(
      ['provider', 'status', 'sectionRevision', 'stems', 'vocals', 'maxSec', 'commercial', 'ready'],
      m.map((p) => [p.displayName, p.status, p.sectionRevision, p.stems, p.vocals, p.maxDurationSeconds, p.commercialUseAllowed, p.ready ? 'yes' : 'NO']),
    ),
    el('div', { class: 'panel-h' }, 'provider-a 차단 사유'),
    el('p', { class: 'mono' }, readinessGate('provider-a').blocking.join(', ')),
    el('div', { class: 'panel-h' }, '활성 어댑터'),
    table(['role', 'provider', 'model'], Object.entries(ACTIVE_ADAPTERS).map(([k, v]) => [k, v.provider, v.modelId])),
  );
}

function auditView(s) {
  return table(
    ['t', 'actor', 'action', 'target'],
    s.audit.slice(-70).reverse().map((a) => [a.at.slice(11, 19), a.actor, a.action, String(a.target).slice(0, 26)]),
  );
}

function idemView(s) {
  const rows = Object.entries(s.idempotency).slice(-40).map(([k, v]) => [
    k.slice(0, 42),
    v.status,
    v.operation || '-',
    (v.completedAt || v.startedAt || '').slice(11, 19),
  ]);
  return el(
    'div',
    { class: 'stack' },
    el('p', { class: 'small muted' }, '유료 생성 요청은 이 키로 중복 과금과 중복 생성을 막습니다. 동일 키 재호출은 저장된 결과를 재생합니다.'),
    table(['key', 'status', 'operation', 'at'], rows),
  );
}
