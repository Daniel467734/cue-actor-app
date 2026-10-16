import { h, toast, formatDate, confirmDialog } from '../util.js';
import { listScripts, saveScript, deleteScript, sessionsFor } from '../store.js';
import { importFile, importText } from '../importers.js';
import { newScript, parseScriptText, listCharacters } from '../parser.js';
import { summarize } from '../stats.js';

const DEMO = `MARA: You're late. The last bus left ten minutes ago.
JONAH: I know. I watched it leave. It waved.
MARA: Buses don't wave.
JONAH: This one did. Slowly. Like it was sorry.
MARA: (laughing) You've been standing out here the whole time, haven't you?
JONAH: Somebody had to keep the bench warm.
MARA: Come inside. I'll make tea, and you can tell me why you really came.
JONAH: What makes you think there's a reason?
MARA: Nobody walks this far to talk about buses.
JONAH: Fine. I got the job. The one overseas.
MARA: Oh.
JONAH: That's it? Oh?
MARA: I'm working on something better. Give me a minute.
JONAH: Take two. I've got nowhere to be.
MARA: Then stay. At least until the tea goes cold.
`;

export async function render(root) {
  const grid = h('div', { class: 'cards' });
  const fileInput = h('input', { type: 'file', accept: '.pdf,.txt,.docx,.fdx,.fountain,.md,text/plain', multiple: true, hidden: true });
  const drop = h('div', { class: 'drop' },
    h('div', { class: 'drop-ico' }, '🎭'),
    h('h3', {}, 'Drop a script here'),
    h('p', { class: 'muted' }, 'PDF, Word, Final Draft, Fountain or plain text'),
    h('div', { class: 'row center gap wrap' },
      h('button', { class: 'btn gold', onclick: () => fileInput.click() }, 'Choose files'),
      h('button', { class: 'btn', onclick: pasteDialog }, 'Paste text'),
      h('button', { class: 'btn', onclick: () => (location.hash = '#/dictate') }, '🎙 Dictate one'),
      h('button', { class: 'btn ghost', onclick: demo }, 'Try a demo')));

  async function add(script) {
    await saveScript(script);
    location.hash = `#/script/${script.id}`;
  }

  async function handleFiles(files) {
    let last;
    for (const f of files) {
      try {
        toast(`Reading ${f.name}…`);
        last = await importFile(f);
        await saveScript(last);
      } catch (e) {
        toast(`${f.name}: ${e.message}`, 5000);
      }
    }
    if (last) location.hash = `#/script/${last.id}`;
  }

  function demo() {
    const { items, format } = parseScriptText(DEMO);
    add(newScript({ title: 'The Last Bus Home (demo)', items, format }));
  }

  function pasteDialog() {
    const ta = h('textarea', { class: 'input paste', placeholder: 'HAMLET: To be, or not to be…\n\nor screenplay format', rows: 10 });
    const title = h('input', { class: 'input', placeholder: 'Title (optional)' });
    const dlg = h('div', { class: 'overlay' },
      h('div', { class: 'dialog wide' },
        h('h3', {}, 'Paste a script'), title, ta,
        h('div', { class: 'row end gap' },
          h('button', { class: 'btn ghost', onclick: () => dlg.remove() }, 'Cancel'),
          h('button', {
            class: 'btn gold',
            onclick: async () => {
              try {
                const s = importText(ta.value, title.value.trim() || 'Pasted script');
                dlg.remove();
                await add(s);
              } catch (e) {
                toast(e.message, 5000);
              }
            },
          }, 'Import'))));
    document.body.append(dlg);
    ta.focus();
  }

  fileInput.addEventListener('change', () => { handleFiles([...fileInput.files]); fileInput.value = ''; });
  const onDrag = (e) => { e.preventDefault(); drop.classList.toggle('over', e.type === 'dragover'); };
  drop.addEventListener('dragover', onDrag);
  drop.addEventListener('dragleave', onDrag);
  drop.addEventListener('drop', (e) => { onDrag(e); handleFiles([...e.dataTransfer.files]); });

  async function load() {
    const scripts = (await listScripts()).sort((a, b) => b.updatedAt - a.updatedAt);
    const cards = await Promise.all(scripts.map(async (s) => {
      const sess = await sessionsFor(s.id);
      const last = sess[sess.length - 1];
      const cast = listCharacters(s.items);
      return h('article', { class: 'card', tabindex: 0, onclick: () => (location.hash = `#/script/${s.id}`) },
        h('h3', {}, s.title),
        h('p', { class: 'muted' }, `${cast.length} characters · ${s.items.filter((i) => i.type === 'dialogue').length} lines`),
        h('p', { class: 'muted small' }, last ? `Last run ${formatDate(last.startedAt)} · ${summarize(last.results).clean}% clean` : `Added ${formatDate(s.createdAt)}`),
        h('button', {
          class: 'icon-btn tiny del', 'aria-label': `Delete ${s.title}`,
          onclick: async (e) => {
            e.stopPropagation();
            if (await confirmDialog(`Delete "${s.title}" and its history?`)) {
              await deleteScript(s.id);
              load();
            }
          },
        }, '✕'));
    }));
    grid.replaceChildren(...cards);
  }

  await load();
  root.replaceChildren(h('section', { class: 'page' },
    h('div', { class: 'hero' }, h('h1', {}, 'Your scripts'), h('p', { class: 'lead' }, 'Upload, pick your part, and run lines with a scene partner who never gets tired.')),
    drop, fileInput, grid));
}
