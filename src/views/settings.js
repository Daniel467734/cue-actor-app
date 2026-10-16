import { h, toast, download, confirmDialog } from '../util.js';
import { getSettings, saveSettings, exportBackup, importBackup, db } from '../store.js';
import { maybeTour, canInstall, install, isIOS } from '../tour.js';
import { loadNeural, neuralReady, gpuAvailable, hqWanted, setHQ } from '../neural.js';
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
  }, [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'], ['en-IN', 'English (India)']]
    .map(([v, l]) => h('option', { value: v, selected: v === s.lang }, l)));

  const nStatus = h('small', { class: 'muted block' }, neuralReady() ? 'Voices are downloaded and ready.' : 'Downloads automatically the first time you rehearse.');
  const nBtn = h('button', { class: 'btn gold' }, 'Download voices now (~90MB)');
  nBtn.hidden = neuralReady();
  nBtn.onclick = async () => {
    nBtn.disabled = true;
    try {
      await loadNeural((p) => (nStatus.textContent = `Downloading voices… ${p}%`));
      nStatus.textContent = 'Voices are downloaded and ready.';
      nBtn.hidden = true;
    } catch (e) {
      nBtn.disabled = false;
      nStatus.textContent = 'Couldn\'t download the voices. Check your connection and try again. Until then, your device\'s built-in voice is used.';
    }
  };

  root.replaceChildren(h('section', { class: 'page' },
    h('h1', {}, 'Settings'),
    h('div', { class: 'panel' }, h('h3', {}, 'Natural voices'),
      h('p', { class: 'muted' }, 'Lifelike scene partners, with male and female voices picked for each character automatically. Downloads once (~90MB) and then runs on your device, no internet needed. A little slower on older phones.'),
      nBtn, nStatus,
      gpuAvailable() && h('label', { class: 'toggle-row' },
        h('input', { type: 'checkbox', checked: hqWanted(), onchange: (e) => { setHQ(e.target.checked); toast('Reloading with the new quality setting'); setTimeout(() => location.reload(), 700); } }),
        ' Studio quality (uses your graphics chip, ~300MB download, best on a laptop or recent phone)')),
    h('div', { class: 'panel' }, h('h3', {}, 'Speech'),
      h('label', { class: 'field' }, h('span', {}, 'Language (listening and default voices)'), lang),
      h('label', { class: 'field' }, h('span', {}, 'Narrator voice (stage directions)'), picker),
      h('button', { class: 'btn small', onclick: () => { cancelSpeech(); speak('Lights up. Whenever you are ready.', { voiceURI: picker.value, rate: s.speechRate }); } }, '▶ Test voice'),),
    h('div', { class: 'panel' }, h('h3', {}, 'Install & help'),
      h('p', { class: 'muted' }, isIOS() ? 'To install: tap Share, then "Add to Home Screen". It then works offline like an app.' : 'Install Cue to open it like an app. After the first visit it works with no signal.'),
      h('div', { class: 'row wrap gap' },
        canInstall() && h('button', { class: 'btn gold', onclick: install }, 'Install app'),
        h('button', { class: 'btn', onclick: () => maybeTour(true) }, 'Show the tour'))),
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
