import { h } from './util.js';

const STEPS = [
  ['🎭', 'Welcome to Cue', 'Run lines with a scene partner that never gets tired, and turn spoken words into a proper script.'],
  ['📥', 'Bring a script', 'Upload a PDF, Word, Final Draft or text file, paste one in, or talk it out with Dictate. Everything stays on your device.'],
  ['🗣', 'Rehearse', 'Pick your character. Your scene partner reads the other lines and Cue listens for yours. Say "prompt" or tap 💡 any time you need a line.'],
  ['🧠', 'Learn the lines', 'Smart fade slowly hides your words as you improve, and "Due for review" brings back lines at the right time to lock them in.'],
  ['🎥', 'Self-tape', 'Turn on Self-tape in the rehearsal options to record yourself with the partner\'s voice, then save or share the video.'],
];

export function maybeTour(force = false) {
  if (!force && localStorage.getItem('cue-toured')) return;
  let i = 0;
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true' });
  const wrap = h('div', { class: 'tour' }, card);
  const close = () => {
    localStorage.setItem('cue-toured', '1');
    wrap.remove();
  };
  const draw = () => {
    const [ico, title, text] = STEPS[i];
    card.replaceChildren(
      h('div', { style: 'font-size:44px' }, ico), h('h2', {}, title), h('p', { class: 'muted' }, text),
      h('div', { class: 'tour-dots' }, STEPS.map((_, k) => h('i', { class: k === i ? 'on' : '' }))),
      h('div', { class: 'row gap center', style: 'justify-content:center' },
        h('button', { class: 'btn ghost', onclick: close }, 'Skip'),
        h('button', { class: 'btn gold', onclick: () => (i < STEPS.length - 1 ? (i++, draw()) : close()) }, i < STEPS.length - 1 ? 'Next' : 'Let\'s go')));
  };
  draw();
  document.body.append(wrap);
}

let deferred = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  document.dispatchEvent(new Event('cue-installable'));
});
export const canInstall = () => !!deferred;
export async function install() {
  if (!deferred) return;
  deferred.prompt();
  await deferred.userChoice;
  deferred = null;
}
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
