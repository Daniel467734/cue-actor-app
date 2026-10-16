export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(msg, ms = 2600) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function download(filename, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const slug = (s) => (s || 'script').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'script';

export function titleCase(s) {
  return String(s).toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

export function confirmDialog(message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const done = (v) => {
      overlay.remove();
      resolve(v);
    };
    const overlay = h(
      'div',
      { class: 'overlay', onclick: (e) => e.target === overlay && done(false) },
      h('div', { class: 'dialog' }, h('p', {}, message), h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => done(false) }, 'Cancel'),
        h('button', { class: 'btn danger', onclick: () => done(true) }, okLabel))),
    );
    document.body.append(overlay);
  });
}

export function promptDialog(message, initial = '') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value: initial, class: 'input' });
    const done = (v) => {
      overlay.remove();
      resolve(v);
    };
    const overlay = h(
      'div',
      { class: 'overlay', onclick: (e) => e.target === overlay && done(null) },
      h('form', { class: 'dialog', onsubmit: (e) => { e.preventDefault(); done(input.value.trim() || null); } },
        h('p', {}, message), input,
        h('div', { class: 'row end' },
          h('button', { type: 'button', class: 'btn ghost', onclick: () => done(null) }, 'Cancel'),
          h('button', { class: 'btn gold', type: 'submit' }, 'OK'))),
    );
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}
