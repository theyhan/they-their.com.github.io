/**
 * share-page.js — private share page for the recipient.
 *
 * Prototype limitation, stated on the page itself: the share payload lives in
 * this browser's localStorage, so the link only resolves on the device that
 * created it. In production this is a short-lived signed URL against a private
 * object-storage key.
 */

import { el, $, clear } from './ui/dom.js';
import * as store from './core/store.js';
import { drawLyricCard } from './ui/lyriccard.js';

const host = clear($('#shareBody'));
const id = location.hash.replace('#', '');
const s = store.load();
const share = (s.shares || {})[id];

if (!share) {
  host.append(
    el('div', { class: 'panel stack' },
      el('h2', {}, '이 링크를 열 수 없습니다'),
      el('p', { class: 'muted' },
        '프로토타입에서는 공유 데이터가 링크를 만든 브라우저에만 저장됩니다. 실제 서비스에서는 만료 시간이 있는 서명된 URL로 대체됩니다.'),
      el('a', { class: 'btn', href: 'index.html' }, '처음으로')),
  );
} else {
  store.emit('share_opened', { shareId: id });
  const canvas = el('canvas', { style: 'width:100%;max-width:420px;border-radius:12px;display:block' });
  drawLyricCard(canvas, {
    title: `${share.recipient || ''}에게`,
    recipient: share.recipient,
    occasion: share.occasion,
    lines: share.lines,
    theme: 'warm',
    disclosure: share.disclosure,
  });
  host.append(
    el('div', { class: 'panel stack' },
      el('div', { class: 'small dim' }, share.occasion),
      el('h2', {}, `${share.recipient || ''}에게 보내는 노래`),
      canvas,
      el('div', { class: 'panel-h', style: 'margin-top:18px' }, '후렴'),
      el('div', {}, share.lines.map((l) => el('div', { style: 'font-size:17px' }, l))),
      el('div', { class: 'notice notice-info' }, share.disclosure),
      el('p', { class: 'tiny dim' }, `공유 생성 ${share.createdAt.slice(0, 16).replace('T', ' ')} · 링크를 아는 사람만 볼 수 있습니다`)),
  );
}
