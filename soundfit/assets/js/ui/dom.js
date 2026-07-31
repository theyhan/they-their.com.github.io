/** dom.js — minimal DOM helpers (no framework: this has to stay a static site). */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function fmtTime(seconds) {
  if (!isFinite(seconds)) return '0:00';
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtKrw(n) {
  return '₩' + n.toLocaleString('ko-KR');
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function toast(message, kind = 'info', ms = 3600) {
  let host = $('#toasts');
  if (!host) {
    host = el('div', { id: 'toasts', class: 'toasts' });
    document.body.append(host);
  }
  const t = el('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  host.append(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 400);
  }, ms);
}

export function confirmDialog(message, { confirmText = '확인', cancelText = '취소' } = {}) {
  return new Promise((resolve) => {
    const close = (v) => { wrap.remove(); resolve(v); };
    const wrap = el(
      'div',
      { class: 'modal-backdrop', onclick: (e) => { if (e.target === wrap) close(false); } },
      el(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        el('p', { class: 'modal-msg' }, message),
        el(
          'div',
          { class: 'modal-actions' },
          el('button', { class: 'btn btn-ghost', onclick: () => close(false) }, cancelText),
          el('button', { class: 'btn btn-primary', onclick: () => close(true) }, confirmText),
        ),
      ),
    );
    document.body.append(wrap);
  });
}
