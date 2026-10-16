import { h, toast, download, confirmDialog } from '../util.js';
import { getSettings, saveSettings, exportBackup, importBackup, db } from '../store.js';
import { getVoices, rankVoices, voiceLabel, speak, cancelSpeech } from '../speech.js';

export async function render(root) {
  const s = getSettings();
  const voices = await getVoices();
  const picker = h('select', {
    class: 'type-sel', 'aria-label': 'Narrator voice',
    onchange: (e) => saveSettings({ narratorURI: e.target.value }),
  }, h('option', { value: '' }, 'Automatic'), [...rankVoices(voices, s.lang), ...voices.filter((v) => !rankVoices(voices, s.lang).includes(v))].map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === s.narratorURI }, voiceLabel(v, s.lang))));
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  file.addEventListener('change', async () => {
    try {
      const r = await importBackup(await file.files[0].text());
      toast(`Restored ${r.scripts} scripts, ${r.sessions} sessions`);
    } catch (e) {
      toast(e.message, 5000);
    }
    file.value = '';
  });
  const lang = h('select', {
    class: 'type-sel', 'aria-label': 'Language',
    onchange: (e) => saveSettings({ lang: e.target.value }),
  }, [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'], ['en-IN', 'English (India)'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['it-IT', 'Italiano']]
    .map(([v, l]) => h('option', { value: v, selected: v === s.lang }, l)));

  root.replaceChildren(h('section', { class: 'page' },
    h('h1', {}, 'Settings'),
    h('div', { class: 'panel' }, h('h3', {}, 'Speech'),
      h('label', { class: 'field' }, h('span', {}, 'Language (listening and default voices)'), lang),
      h('label', { class: 'field' }, h('span', {}, 'Narrator voice (stage directions)'), picker),
      h('button', { class: 'btn small', onclick: () => { cancelSpeech(); speak('Lights up. Whenever you are ready.', { voiceURI: picker.value, rate: s.speechRate }); } }, '▶ Test voice'),
      h('p', { class: 'muted' }, 'Voices marked ★ are the most natural. On Mac/iPhone, add more under Settings → Accessibility → Spoken Content → Voices (choose Enhanced/Premium). Tip: wear headphones so the scene partner isn\'t picked up by your mic. Speech recognition needs Chrome, Edge or Safari, and an internet connection in most browsers.')),
    h('div', { class: 'panel' }, h('h3', {}, 'Backup'),
      h('p', { class: 'muted' }, 'Everything lives only on this device. Save a backup file to move it or keep it safe (audio recordings aren\'t included).'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn gold', onclick: async () => download(`cue-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), 'application/json') }, 'Export backup'),
        h('button', { class: 'btn', onclick: () => file.click() }, 'Import backup'), file)),
    h('div', { class: 'panel' }, h('h3', {}, 'Danger zone'),
      h('button', {
        class: 'btn danger',
        onclick: async () => {
          if (await confirmDialog('Delete ALL scripts, sessions and recordings on this device?', 'Delete everything')) {
            for (const st of ['scripts', 'sessions', 'recordings']) {
              for (const r of await db.getAll(st)) await db.delete(st, r.id);
            }
            toast('Everything deleted');
          }
        },
      }, 'Erase all data'))));
}
