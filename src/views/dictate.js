import { h, toast, download, slug, promptDialog } from '../util.js';
import { newScript, uid, cleanName, listCharacters } from '../parser.js';
import { saveScript, getScript } from '../store.js';
import { Listener, sttSupported, MicMonitor } from '../speech.js';
import { toText, toFountain, toPDF } from '../exporters.js';
import { scriptEditor } from './editor.js';
import { keepAwake } from '../wake.js';

const PUNCT = [
  [/\s*\b(?:full stop|period)\b\s*/gi, '. '],
  [/\s*\bcomma\b\s*/gi, ', '],
  [/\s*\bquestion mark\b\s*/gi, '? '],
  [/\s*\bexclamation (?:mark|point)\b\s*/gi, '! '],
  [/\s*\bellipsis\b\s*/gi, '... '],
  [/\s*\bdot dot dot\b\s*/gi, '... '],
  [/\s*\bnew paragraph\b\s*/gi, ' '],
  [/\s*\bnew line\b\s*/gi, ' '],
];

function tidy(text) {
  let t = text;
  for (const [re, rep] of PUNCT) t = t.replace(re, rep);
  t = t.replace(/\s+([.,!?])/g, '$1').replace(/\s+/g, ' ').trim();
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\bi\b/g, 'I');
  if (t && !/[.!?…"')\]]$/.test(t)) t += '.';
  return t;
}

export async function render(root, { id }) {
  let script = id ? await getScript(id) : null;
  if (!script) {
    script = newScript({ title: `Dictated script ${new Date().toLocaleDateString()}`, format: 'stage' });
    script.dictated = true;
  }
  let speaker = listCharacters(script.items).slice(-1)[0]?.name || '';
  let mode = 'dialogue';
  let listening = false;
  let tab = 'edit';
  let saveTimer;
  let release = () => {};

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (script.items.length || script.savedOnce) {
        script.savedOnce = true;
        saveScript(script);
      }
    }, 400);
  };

  const interim = h('div', { class: 'interim', 'aria-live': 'polite' }, 'Tap the mic and start talking…');
  const castEl = h('div', { class: 'chips' });
  const modeEl = h('div', { class: 'chips' });
  const levelBar = h('div', { class: 'level' }, h('i'));
  const micBtn = h('button', { class: 'mic-btn', 'aria-label': 'Start dictating', onclick: () => toggle() },
    h('span', { class: 'mic-ico' }, '🎙'), h('span', { class: 'mic-label' }, 'Start'));
  const body = h('div', { class: 'dictate-body' });

  const editor = scriptEditor(script, () => {
    renderCast();
    save();
  });

  function addItem(item) {
    script.items.push({ id: uid(), ...item });
    editor.refresh();
    editor.scrollToEnd();
    renderCast();
    save();
  }

  function setSpeaker(name) {
    speaker = cleanName(name);
    mode = 'dialogue';
    renderCast();
    renderMode();
    toast(`Speaker: ${speaker}`, 1200);
  }

  function known() {
    const names = new Set(listCharacters(script.items).map((c) => c.name));
    if (speaker) names.add(speaker);
    return [...names].sort((a, b) => b.length - a.length);
  }

  function handleChunk(raw) {
    const text = raw.trim();
    if (!text) return;
    const low = text.toLowerCase().replace(/[.,!?]+$/g, '').trim();
    const cast = known();

    if (/^(?:scratch that|delete that|undo(?: that)?|remove that|delete last line)$/.test(low)) {
      script.items.pop();
      editor.refresh();
      renderCast();
      save();
      return toast('Removed last line', 1200);
    }
    let m;
    if ((m = /^(?:new scene|scene heading|scene)\s*[:,]?\s*(.*)$/i.exec(text))) {
      if (m[1]) addItem({ type: 'scene', text: tidy(m[1]).replace(/\.$/, '').toUpperCase() });
      else mode = 'scene';
      return renderMode();
    }
    if ((m = /^(?:stage direction|direction|action)\s*[:,]?\s*(.*)$/i.exec(text))) {
      if (m[1]) addItem({ type: 'direction', text: tidy(m[1]) });
      else mode = 'direction';
      return renderMode();
    }
    if ((m = /^parenthetical\s*[:,]?\s*(.*)$/i.exec(text))) {
      if (m[1]) addItem({ type: 'direction', parenthetical: true, text: tidy(m[1]).replace(/\.$/, '') });
      else mode = 'parenthetical';
      return renderMode();
    }
    if ((m = /^(?:character|speaker|next speaker|new character)\s+(.+)$/i.exec(text))) {
      const rest = m[1];
      const hit = cast.find((n) => rest.toLowerCase().startsWith(n.toLowerCase()));
      let name;
      let tail = '';
      if (hit) {
        name = hit;
        tail = rest.slice(hit.length);
      } else {
        const sm = /^(.+?)\s+(?:says?|colon)\b[:,]?\s*(.*)$/i.exec(rest);
        if (sm) [, name, tail] = sm;
        else if (rest.split(/\s+/).length <= 3) name = rest;
        else {
          const words = rest.split(/\s+/);
          name = words[0];
          tail = words.slice(1).join(' ');
        }
      }
      setSpeaker(name.replace(/[.,:]+$/, ''));
      tail = tail.replace(/^\s*(?:says?|colon)\b[:,]?\s*/i, '').trim();
      return tail ? handleChunk(tail) : undefined;
    }
    const nameOnly = cast.find((n) => n.toLowerCase() === low);
    if (nameOnly) return setSpeaker(nameOnly);
    const says = cast.map((n) => ({ n, re: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:says?|colon)\\b[:,]?\\s*(.*)$`, 'i') }))
      .map(({ n, re }) => [n, re.exec(text)]).find(([, r]) => r);
    if (says) {
      setSpeaker(says[0]);
      return says[1][1] ? handleChunk(says[1][1]) : undefined;
    }

    const clean = tidy(text);
    if (mode === 'scene') addItem({ type: 'scene', text: clean.replace(/\.$/, '').toUpperCase() });
    else if (mode === 'direction') addItem({ type: 'direction', text: clean });
    else if (mode === 'parenthetical') addItem({ type: 'direction', parenthetical: true, text: clean.replace(/\.$/, '') });
    else {
      if (!speaker) {
        toast('Say or tap a character name first');
        speaker = 'UNKNOWN';
      }
      addItem({ type: 'dialogue', character: speaker, text: clean });
    }
    if (mode !== 'dialogue') {
      mode = 'dialogue';
      renderMode();
    }
  }

  const listener = new Listener({
    onText: (t) => {
      interim.textContent = t || '…';
      interim.classList.toggle('active', !!t);
    },
    onFinal: (t) => {
      handleChunk(t);
      interim.textContent = 'Listening…';
      interim.classList.remove('active');
    },
    onError: (msg) => {
      toast(msg, 4500);
      setListening(false);
    },
  });
  const mic = new MicMonitor();
  let meterRaf;

  async function toggle() {
    if (!sttSupported) return toast('Speech recognition isn\'t supported in this browser. Try Chrome, Edge or Safari.', 4500);
    if (listening) return setListening(false);
    setListening(true);
  }

  async function setListening(on) {
    listening = on;
    micBtn.classList.toggle('live', on);
    micBtn.querySelector('.mic-label').textContent = on ? 'Stop' : 'Start';
    micBtn.setAttribute('aria-label', on ? 'Stop dictating' : 'Start dictating');
    if (on) {
      interim.textContent = 'Listening…';
      listener.start();
      release = await keepAwake();
      if (await mic.start({ record: false })) {
        const tick = () => {
          levelBar.firstChild.style.transform = `scaleX(${mic.level()})`;
          meterRaf = requestAnimationFrame(tick);
        };
        tick();
      }
    } else {
      listener.stop();
      cancelAnimationFrame(meterRaf);
      levelBar.firstChild.style.transform = 'scaleX(0)';
      mic.stop();
      release();
      interim.textContent = 'Paused. Tap the mic to continue.';
      interim.classList.remove('active');
    }
  }

  function renderCast() {
    const names = known();
    castEl.replaceChildren(
      h('span', { class: 'chip-label' }, 'Speaker'),
      ...names.map((n) => h('button', { class: `chip${n === speaker ? ' on' : ''}`, onclick: () => setSpeaker(n) }, n)),
      h('button', {
        class: 'chip add',
        onclick: async () => {
          const n = await promptDialog('Character name');
          if (n) setSpeaker(n);
        },
      }, '+ Character'),
    );
  }

  function renderMode() {
    const modes = [['dialogue', 'Dialogue'], ['direction', 'Stage direction'], ['parenthetical', 'Parenthetical'], ['scene', 'Scene heading']];
    modeEl.replaceChildren(
      h('span', { class: 'chip-label' }, 'Next is'),
      ...modes.map(([k, label]) => h('button', { class: `chip${mode === k ? ' on' : ''}`, onclick: () => { mode = k; renderMode(); } }, label)),
    );
  }

  const title = h('input', {
    class: 'title-input', value: script.title, 'aria-label': 'Script title',
    oninput: (e) => {
      script.title = e.target.value;
      script.savedOnce = true;
      save();
    },
  });

  const fmtSel = h('select', {
    class: 'type-sel', 'aria-label': 'Script format',
    onchange: (e) => {
      script.format = e.target.value;
      save();
      showTab();
    },
  }, [['stage', 'Stage play'], ['screenplay', 'Screenplay']].map(([v, l]) => h('option', { value: v, selected: script.format === v }, l)));

  const tabs = h('div', { class: 'tabs' }, ['edit', 'preview'].map((t) =>
    h('button', { class: `tab${tab === t ? ' on' : ''}`, onclick: () => { tab = t; showTab(); } }, t === 'edit' ? 'Edit' : 'Formatted preview')));

  function showTab() {
    tabs.querySelectorAll('.tab').forEach((b, i) => b.classList.toggle('on', (i === 0) === (tab === 'edit')));
    body.replaceChildren(tab === 'edit' ? editor.el : h('pre', { class: 'preview' }, toText(script) || 'Nothing yet.'));
  }

  const needScript = () => {
    if (!script.items.length) {
      toast('Nothing to export yet');
      return false;
    }
    script.savedOnce = true;
    return true;
  };

  const actions = h('div', { class: 'row wrap gap' },
    h('button', {
      class: 'btn gold',
      onclick: async () => {
        if (!needScript()) return;
        setListening(false);
        await saveScript(script);
        location.hash = `#/script/${script.id}`;
      },
    }, '🎭 Save & rehearse'),
    h('button', { class: 'btn', onclick: async () => needScript() && download(`${slug(script.title)}.pdf`, await toPDF(script), 'application/pdf') }, 'PDF'),
    h('button', { class: 'btn', onclick: () => needScript() && download(`${slug(script.title)}.fountain`, toFountain(script)) }, 'Fountain'),
    h('button', { class: 'btn', onclick: () => needScript() && download(`${slug(script.title)}.txt`, toText(script)) }, 'Text'),
  );

  const help = h('details', { class: 'help' },
    h('summary', {}, 'Voice commands'),
    h('ul', {},
      h('li', {}, h('b', {}, '"Character John"'), ' or just say ', h('b', {}, '"John"'), ' to switch speaker (once you\'ve added them)'),
      h('li', {}, h('b', {}, '"John says hello there"'), ' sets the speaker and the line in one go'),
      h('li', {}, h('b', {}, '"Stage direction he crosses to the window"')),
      h('li', {}, h('b', {}, '"Parenthetical angrily"'), ' and ', h('b', {}, '"Scene INT kitchen night"')),
      h('li', {}, h('b', {}, '"Scratch that"'), ' removes the last line'),
      h('li', {}, 'Say ', h('b', {}, '"comma"'), ', ', h('b', {}, '"period"'), ', ', h('b', {}, '"question mark"'), ' for punctuation')));

  renderCast();
  renderMode();
  showTab();

  root.replaceChildren(
    h('section', { class: 'page dictate' },
      h('div', { class: 'page-head' }, h('h1', {}, 'Dictate'), h('div', { class: 'row gap' }, fmtSel)),
      title,
      h('div', { class: 'panel stage-panel' },
        h('div', { class: 'row gap center' }, micBtn, h('div', { class: 'grow' }, interim, levelBar)),
        castEl, modeEl, help,
        !sttSupported && h('p', { class: 'warn' }, 'This browser has no speech recognition. Use Chrome, Edge or Safari to dictate. You can still type lines below.')),
      tabs, body, actions),
  );

  return () => {
    listener.stop();
    cancelAnimationFrame(meterRaf);
    mic.stop();
    release();
    clearTimeout(saveTimer);
    if (script.savedOnce) saveScript(script);
  };
}
