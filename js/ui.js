// Tiny DOM helpers shared by the page modules. No framework.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('p', {class: 'x', onclick: fn, hidden: true}, 'text', childNode, [more])
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k === undefined || k === null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }
export function show(el, on = true) { if (el) el.hidden = !on; return el; }

// Move focus to a phase heading (tabindex -1), as § UX Accessibility asks.
export function focusHeading(el) {
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: false });
}

let uid = 0;
export const nextId = (p = 'u') => `${p}${++uid}`;

export const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export function fmtMoney(n) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  return (v < 0 ? '-' : '') + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
