import { loadNeural } from '../neural.js';
import { h, toast, download, slug, confirmDialog, promptDialog, formatDate, formatDuration } from '../util.js';
import { getScript, saveScript, sessionsFor, deleteSession, getRecording, getSettings, saveSettings } from '../store.js';
import { listCharacters } from '../parser.js';
import { getVoices, autoVoice, rankVoices, voiceLabel, speak, cancelSpeech, sttSupported, isMobile } from '../speech.js';
import { STRICTNESS } from '../matcher.js';
import { lineStats, dueLineIds, troubleLineIds, summarize, STATUS } from '../stats.js';
import { toText, toFountain, toPDF } from '../exporters.js';
import { scriptEditor } from './editor.js';

export async function render(root, { id }) {
  const script = await getScript(id);
  if (!script) {
    location.hash = '#/';
    return;
  }
  const settings = getSettings();
  const voices = await getVoices();
  loadNeural().catch(() => {});
  if (isMobile) loadNeural().catch(() => {}).then(() => import('../localstt.js')).then((m) => m.loadStt()).catch(() => {});
  let sessions = await sessionsFor(id);
  let tab = sessionStorage.getItem(`cue-tab-${id}`) || 'rehearse';
  const chars = () => listCharacters(script.items);
  let me = sessionStorage.getItem(`cue-char-${id}`) || chars()[0]?.name;
  if (!chars().some((c) => c.name === me)) me = chars()[0]?.name;
  const opts = { mode: 'full', startId: null, sceneOnly: true };

  const body = h('div', { class: 'tab-body' });
  const tabsEl = h('div', { class: 'tabs' });

  const titleInput = h('input', {
    class: 'title-input', value: script.title, 'aria-label': 'Script title',
    onchange: (e) => {
      script.title = e.target.value.trim() || script.title;
      saveScript(script);
    },
  });

  function renderTabs() {
    tabsEl.replaceChildren(...[['rehearse', '🎭 Rehearse'], ['progress', '📈 Progress'], ['script', '📜 Script']].map(([k, l]) =>
      h('button', { class: `tab${tab === k ? ' on' : ''}`, onclick: () => { tab = k; sessionStorage.setItem(`cue-tab-${id}`, k); renderTabs(); renderBody(); } }, l)));
  }

  function voiceSelect(name) {
    const auto = autoVoice(name, voices, settings.lang, chars().map((c) => c.name));
    const current = script.voices?.[name] || auto.uri;
    const sel = h('select', {
      class: 'type-sel',
      'aria-label': `Voice for ${name}`,
      onchange: (e) => {
        script.voices = { ...script.voices, [name]: e.target.value };
        saveScript(script);
      },
    }, [...rankVoices(voices, settings.lang), ...voices.filter((v) => !rankVoices(voices, settings.lang).includes(v))].map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === current }, voiceLabel(v, settings.lang))));
    return h('div', { class: 'row gap center voice-row' },
      h('span', { class: 'grow' }, name),
      voices.length ? sel : h('span', { class: 'muted' }, 'Default voice'),
      h('button', {
        class: 'btn ghost small',
        onclick: async () => {
          cancelSpeech();
          speak(`${name.toLowerCase()} here. Ready when you are.`, { voiceURI: sel.value || auto.uri, pitch: 1, rate: settings.speechRate });
        },
      }, '▶'));
  }

  function slider(label, key, min, max, step, fmt) {
    const val = h('b', {}, fmt(settings[key]));
    const input = h('input', {
      type: 'range', min, max, step, value: settings[key],
      oninput: (e) => {
        settings[key] = Number(e.target.value);
        val.textContent = fmt(settings[key]);
        saveSettings({ [key]: settings[key] });
      },
    });
    return h('label', { class: 'field' }, h('span', {}, label, ' ', val), input);
  }

  function toggle(label, key, hint) {
    return h('label', { class: 'switch-row' },
      h('div', {}, h('div', {}, label), hint && h('small', { class: 'muted' }, hint)),
      h('input', { type: 'checkbox', checked: settings[key], onchange: (e) => { settings[key] = e.target.checked; saveSettings({ [key]: e.target.checked }); } }));
  }

  function rehearseTab() {
    const cs = chars();
    const troubles = me ? troubleLineIds(sessions, me).length : 0;
    const startSel = h('select', { class: 'input', 'aria-label': 'Start from', onchange: (e) => (opts.startId = e.target.value || null) },
      h('option', { value: '' }, 'The beginning (whole script)'),
      ...script.items.filter((it) => it.type === 'scene' || (it.type === 'dialogue' && it.character === me)).map((it) =>
        h('option', { value: it.id }, it.type === 'scene' ? `Scene: ${it.text.slice(0, 40)}` : `${me}: ${it.text.slice(0, 40)}…`)));
    const due = me ? dueLineIds(sessions, me, script.items).length : 0;
    const modeSel = h('div', { class: 'seg' },
      ['full', 'due', 'trouble'].map((m) => h('button', {
        class: `seg-btn${opts.mode === m ? ' on' : ''}`,
        disabled: (m === 'trouble' && !troubles) || (m === 'due' && !due),
        onclick: () => { opts.mode = m; startSel.disabled = m !== 'full'; renderBody(); },
      }, m === 'full' ? 'Full run' : m === 'due' ? `Due for review${due ? ` (${due})` : ''}` : `Trouble lines${troubles ? ` (${troubles})` : ''}`)));
    startSel.disabled = opts.mode !== 'full';

    return h('div', {},
      h('div', { class: 'panel' },
        h('h3', {}, 'Who are you playing?'),
        h('div', { class: 'chips big' }, cs.map((c) => h('button', {
          class: `chip${c.name === me ? ' on' : ''}`,
          onclick: () => { me = c.name; sessionStorage.setItem(`cue-char-${id}`, me); renderBody(); },
        }, `${c.name} `, h('small', {}, `${c.lines} lines`))))),
      h('div', { class: 'panel' }, h('h3', {}, 'Session'), modeSel, h('label', { class: 'field' }, h('span', {}, 'Scene / start from'), startSel), h('label', { class: 'switch-row' }, h('div', {}, h('div', {}, 'Stop at the end of that scene'), h('small', { class: 'muted' }, 'Practise one scene at a time')), h('input', { type: 'checkbox', checked: opts.sceneOnly, onchange: (e) => (opts.sceneOnly = e.target.checked) }))),
      h('div', { class: 'panel' },
        h('h3', {}, 'How you want to be judged'),
        h('div', { class: 'seg' }, [1, 2, 3].map((n) => h('button', {
          class: `seg-btn${settings.strictness === n ? ' on' : ''}`,
          onclick: () => { settings.strictness = n; saveSettings({ strictness: n }); renderBody(); },
        }, STRICTNESS[n].name))),
        h('small', { class: 'muted' }, { 1: 'Close enough counts. Paraphrases and a missed word or two are fine.', 2: 'Most words must be right. Small slips and misheard words are forgiven.', 3: 'Word for word. Every word counts, no ad-libs.' }[settings.strictness]),
        slider('Auto-prompt after silence (0 = off)', 'promptDelay', 0, 20, 1, (v) => (v ? `${v}s` : 'off')),
        h('label', { class: 'field' }, h('span', {}, 'Your lines on screen'),
          h('div', { class: 'seg' }, [['show', 'Visible'], ['first', 'First words'], ['hidden', 'Hidden'], ['learn', 'Smart fade']].map(([k, l]) => h('button', {
            class: `seg-btn${settings.hideMode === k ? ' on' : ''}`,
            onclick: () => { settings.hideMode = k; saveSettings({ hideMode: k }); renderBody(); },
          }, l)))),
        slider('Scene partner speed', 'speechRate', 0.6, 1.6, 0.05, (v) => `${v.toFixed(2)}×`),
        toggle('Read stage directions aloud', 'readDirections'),
        toggle('Record my audio', 'record', 'Play it back after the run, stored on this device'),
        toggle('Self-tape (record video)', 'selftape', 'Camera plus your voice and the scene partner. Save or share it after the run'),
        toggle('Success chime', 'sound')),
      h('div', { class: 'panel' }, h('h3', {}, 'Scene partner voices'),
        voices.length ? null : h('p', { class: 'muted' }, 'This browser has no speech voices installed.'),
        cs.filter((c) => c.name !== me).map((c) => voiceSelect(c.name)),
        cs.length < 2 && h('p', { class: 'muted' }, 'This script only has one character.')),
      !sttSupported && h('p', { class: 'warn' }, 'This browser can\'t listen for your lines. You can still run through using the on-screen buttons. For voice, use Chrome, Edge or Safari.'),
      h('div', { class: 'sticky-cta' },
        h('button', {
          class: 'btn gold big', disabled: !me,
          onclick: () => {
            sessionStorage.setItem('cue-run', JSON.stringify({ scriptId: id, character: me, mode: opts.mode, sceneOnly: opts.sceneOnly, startId: opts.mode !== 'full' ? null : opts.startId, options: { ...settings } }));
            location.hash = `#/rehearse/${id}`;
          },
        }, `🎬 Rehearse as ${me || '…'}`)));
  }

  function chart() {
    const data = sessions.slice(-14);
    if (data.length < 2) return null;
    const w = 320;
    const hgt = 90;
    const bw = w / data.length;
    return h('svg', { viewBox: `0 0 ${w} ${hgt + 18}`, class: 'chart', role: 'img', 'aria-label': 'Clean percentage per session' },
      data.map((s, k) => {
        const pct = summarize(s.results).clean;
        const bh = Math.max(2, (pct / 100) * hgt);
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        el.innerHTML = `<rect x="${k * bw + 3}" y="${hgt - bh}" width="${bw - 6}" height="${bh}" rx="3" fill="url(#gold)"/><text x="${k * bw + bw / 2}" y="${hgt + 13}" text-anchor="middle" font-size="9" fill="#9a8f7a">${pct}</text>`;
        return el;
      }));
  }

  function progressTab() {
    if (!sessions.length) return h('div', { class: 'empty' }, h('p', {}, 'No rehearsals yet. Run through a scene and your progress will show up here.'));
    const stats = lineStats(sessions);
    const weak = [...stats.values()].filter((e) => e.weakness > 0).sort((a, b) => b.weakness - a.weakness).slice(0, 12);
    const item = (lid) => script.items.find((x) => x.id === lid);
    const total = sessions.reduce((a, s) => a + (s.endedAt - s.startedAt), 0);
    const best = Math.max(...sessions.map((s) => summarize(s.results).clean));
    return h('div', {},
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('b', {}, sessions.length), h('span', {}, 'sessions')),
        h('div', { class: 'stat' }, h('b', {}, formatDuration(total)), h('span', {}, 'rehearsed')),
        h('div', { class: 'stat' }, h('b', {}, `${best}%`), h('span', {}, 'best run'))),
      h('div', { class: 'panel' }, h('h3', {}, 'Clean lines per session (%)'),
        h('svg', { width: 0, height: 0 }, (() => { const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); d.innerHTML = '<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1d27a"/><stop offset="1" stop-color="#a47a1c"/></linearGradient>'; return d; })()),
        chart() || h('p', { class: 'muted' }, 'Do one more run to see a trend.')),
      h('div', { class: 'panel' }, h('h3', {}, 'Weak spots'),
        weak.length ? weak.map((e) => {
          const it = item(e.lineId);
          if (!it) return null;
          return h('div', { class: 'res-row' },
            h('div', { class: 'grow' }, h('div', {}, it.text), h('small', { class: 'muted' }, `${it.character} · ${e.runs} runs · ${e.missed} missed · ${e.prompted} prompted`)),
            h('span', { class: `res-tag ${e.last === 'ok' ? 'ok' : e.last}` }, STATUS[e.last]?.icon));
        }) : h('p', { class: 'muted' }, 'No weak spots. Every line has been clean. 👏')),
      h('div', { class: 'panel' }, h('h3', {}, 'History'),
        [...sessions].reverse().map((s) => {
          const sm = summarize(s.results);
          const audioHolder = h('div', {});
          return h('div', { class: 'hist' },
            h('div', { class: 'row gap center' },
              h('div', { class: 'grow' }, h('b', {}, `${formatDate(s.startedAt)} · ${s.character}`),
                h('small', { class: 'muted block' }, `${sm.clean}% clean · ${sm.prompted} prompted · ${sm.missed} missed · ${formatDuration(s.endedAt - s.startedAt)}`)),
              s.hasRecording && h('button', {
                class: 'btn ghost small',
                onclick: async () => {
                  const blob = await getRecording(s.id);
                  if (!blob) return toast('Recording not found');
                  audioHolder.replaceChildren(h('audio', { controls: true, autoplay: true, src: URL.createObjectURL(blob) }));
                },
              }, '▶ Audio'),
              h('button', {
                class: 'icon-btn tiny', 'aria-label': 'Delete session',
                onclick: async () => {
                  if (await confirmDialog('Delete this session?')) {
                    await deleteSession(s.id);
                    sessions = await sessionsFor(id);
                    renderBody();
                  }
                },
              }, '✕')),
            audioHolder);
        })));
  }

  function scriptTab() {
    const ed = scriptEditor(script, () => saveScript(script));
    const safe = (fn) => async () => {
      try {
        await fn();
      } catch (e) {
        toast(e.message);
      }
    };
    return h('div', {},
      h('div', { class: 'row wrap gap' },
        h('select', {
          class: 'type-sel', 'aria-label': 'Format',
          onchange: (e) => { script.format = e.target.value; saveScript(script); },
        }, [['stage', 'Stage play'], ['screenplay', 'Screenplay']].map(([v, l]) => h('option', { value: v, selected: script.format === v }, l))),
        h('button', { class: 'btn', onclick: safe(async () => download(`${slug(script.title)}.pdf`, await toPDF(script), 'application/pdf')) }, 'PDF'),
        h('button', { class: 'btn', onclick: () => download(`${slug(script.title)}.fountain`, toFountain(script)) }, 'Fountain'),
        h('button', { class: 'btn', onclick: () => download(`${slug(script.title)}.txt`, toText(script)) }, 'Text'),
        h('button', { class: 'btn', onclick: () => (location.hash = `#/dictate/${id}`) }, '🎙 Dictate more')),
      h('p', { class: 'muted' }, 'Fix any lines the importer got wrong. Edits save automatically.'),
      ed.el);
  }

  function renderBody() {
    body.replaceChildren(tab === 'rehearse' ? rehearseTab() : tab === 'progress' ? progressTab() : scriptTab());
  }

  renderTabs();
  renderBody();
  root.replaceChildren(h('section', { class: 'page script-page' },
    h('div', { class: 'page-head' },
      h('a', { class: 'back', href: '#/' }, '‹ Library'),
      h('button', {
        class: 'btn ghost small',
        onclick: async () => {
          const n = await promptDialog('Rename script', script.title);
          if (n) {
            script.title = n;
            titleInput.value = n;
            saveScript(script);
          }
        },
      }, 'Rename')),
    titleInput, tabsEl, body));
  return () => cancelSpeech();
}
