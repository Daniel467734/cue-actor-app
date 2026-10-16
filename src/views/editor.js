import { TONES } from '../delivery.js';
import { h } from '../util.js';
import { uid, cleanName, listCharacters } from '../parser.js';

// Editable list of script lines. Mutates script.items and calls onChange.
export function scriptEditor(script, onChange = () => {}) {
  const root = h('div', { class: 'editor' });
  const datalistId = `chars-${script.id}`;
  const datalist = h('datalist', { id: datalistId });

  const changed = () => {
    updateDatalist();
    onChange(script);
  };

  function updateDatalist() {
    datalist.replaceChildren(...listCharacters(script.items).map((c) => h('option', { value: c.name })));
  }

  function row(item, index) {
    const del = h('button', {
      class: 'icon-btn tiny', title: 'Delete line', 'aria-label': 'Delete line',
      onclick: () => {
        script.items.splice(script.items.indexOf(item), 1);
        render();
        changed();
      },
    }, '✕');
    const typeSel = h('select', {
      class: 'type-sel', 'aria-label': 'Line type',
      onchange: (e) => {
        item.type = e.target.value;
        if (item.type === 'dialogue' && !item.character) item.character = listCharacters(script.items)[0]?.name || 'CHARACTER';
        if (item.type !== 'dialogue') delete item.character;
        render();
        changed();
      },
    }, ['dialogue', 'direction', 'scene', 'transition'].map((t) => h('option', { value: t, selected: t === item.type }, t)));

    const text = h('div', {
      class: 'line-text', contenteditable: 'plaintext-only', spellcheck: 'true', role: 'textbox', 'aria-label': 'Line text',
      oninput: (e) => {
        item.text = e.target.textContent.replace(/\s+/g, ' ').trim();
        onChange(script);
      },
      onblur: changed,
    }, item.text);

    let who = null;
    if (item.type === 'dialogue') {
      who = h('input', {
        class: 'char-input', list: datalistId, value: item.character || '', placeholder: 'CHARACTER', 'aria-label': 'Character',
        onchange: (e) => {
          item.character = cleanName(e.target.value) || item.character;
          e.target.value = item.character;
          changed();
        },
      });
    }
    const tone = item.type === 'dialogue' ? h('select', {
      class: 'type-sel', 'aria-label': 'Delivery', title: 'How the scene partner delivers this line',
      onchange: (e) => { item.tone = e.target.value; changed(); },
    }, Object.entries(TONES).map(([k, t]) => h('option', { value: k, selected: (item.tone || '') === k }, k ? `🎭 ${t.label}` : '🎭 Auto'))) : null;
    return h('div', { class: `line-row ${item.type}${item.parenthetical ? ' paren' : ''}`, dataset: { id: item.id } },
      h('div', { class: 'line-meta' }, typeSel, who, tone), text, del);
  }

  function render() {
    root.replaceChildren(
      datalist,
      ...script.items.map(row),
      h('div', { class: 'row add-row' },
        h('span', { class: 'muted' }, 'Add:'),
        ...[['dialogue', 'Dialogue'], ['direction', 'Direction'], ['scene', 'Scene']].map(([type, label]) =>
          h('button', {
            class: 'btn ghost small',
            onclick: () => {
              const item = { id: uid(), type, text: '' };
              if (type === 'dialogue') item.character = listCharacters(script.items).slice(-1)[0]?.name || 'CHARACTER';
              script.items.push(item);
              render();
              root.querySelector('.line-row:nth-last-child(2) .line-text')?.focus();
              changed();
            },
          }, `+ ${label}`))),
    );
    updateDatalist();
  }

  render();
  return { el: root, refresh: render, scrollToEnd: () => root.querySelector('.add-row')?.scrollIntoView({ block: 'end', behavior: 'smooth' }) };
}
