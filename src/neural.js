// Optional natural voices: Kokoro-82M running fully in the browser (lazy loaded).
export const NEURAL_PREFIX = 'kokoro:';

const NAMES = {
  af_heart: 'Heart', af_bella: 'Bella', af_nicole: 'Nicole', af_sarah: 'Sarah', af_sky: 'Sky', af_nova: 'Nova', af_jessica: 'Jessica',
  am_adam: 'Adam', am_michael: 'Michael', am_eric: 'Eric', am_liam: 'Liam', am_onyx: 'Onyx', am_puck: 'Puck',
  bf_emma: 'Emma', bf_isabella: 'Isabella', bf_alice: 'Alice', bf_lily: 'Lily',
  bm_george: 'George', bm_lewis: 'Lewis', bm_daniel: 'Daniel', bm_fable: 'Fable',
};

export const neuralVoices = () =>
  Object.entries(NAMES).map(([id, n]) => ({
    voiceURI: NEURAL_PREFIX + id,
    name: `${n} (natural)`,
    lang: id.startsWith('b') ? 'en-GB' : 'en-US',
    localService: true,
    neural: true,
  }));

let tts = null;
let loading = null;
let ctx = null;
let playToken = 0;
let current = null;

export const neuralReady = () => !!tts;

export function loadNeural(onProgress) {
  if (tts) return Promise.resolve(tts);
  if (!loading) {
    loading = import('kokoro-js')
      .then(({ KokoroTTS }) =>
        KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: (p) => {
            if (p.status === 'progress' && onProgress) onProgress(Math.round(p.progress || 0));
          },
        }))
      .then((m) => (tts = m))
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

function splitText(text) {
  const parts = text.match(/[^.!?…]+[.!?…]*["')\]]*\s*/g) || [text];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + p).length > 140) {
      out.push(cur.trim());
      cur = p;
    } else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function playBuffer(samples, rate, token, gain = 1) {
  return new Promise((resolve) => {
    if (token !== playToken) return resolve(false);
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const buf = ctx.createBuffer(1, samples.length, rate);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(ctx.destination);
    current = src;
    src.onended = () => resolve(token === playToken);
    src.start();
  });
}

// Resolves true when finished, false if cancelled.
export async function speakNeural(text, voiceURI, { rate = 1, gain = 1 } = {}) {
  const token = ++playToken;
  const model = await loadNeural();
  const voice = voiceURI.slice(NEURAL_PREFIX.length);
  const pieces = splitText(text);
  const gen = (t) => model.generate(t, { voice, speed: Math.min(1.6, Math.max(0.6, rate)) });
  let next = pieces.length ? gen(pieces[0]) : null;
  for (let i = 0; i < pieces.length; i++) {
    const audio = await next;
    if (token !== playToken) return false;
    next = i + 1 < pieces.length ? gen(pieces[i + 1]) : null;
    const ok = await playBuffer(audio.audio, audio.sampling_rate, token, gain);
    if (!ok) return false;
  }
  return true;
}

export function cancelNeural() {
  playToken++;
  try {
    current?.stop();
  } catch {
    /* already stopped */
  }
  current = null;
}

const FEMALE = ['af_heart', 'af_bella', 'bf_emma', 'af_nicole', 'af_sarah', 'bf_isabella', 'af_sky', 'bf_lily', 'af_nova', 'af_jessica', 'bf_alice'];
const MALE = ['am_michael', 'bm_george', 'am_adam', 'bm_lewis', 'am_eric', 'bm_daniel', 'am_liam', 'am_onyx', 'bm_fable', 'am_puck'];
const FEM_WORDS = /\b(mrs|ms|miss|mum|mom|mother|mama|woman|girl|lady|queen|princess|duchess|countess|sister|aunt|auntie|nan|nana|grandma|gran|wife|daughter|waitress|actress|she)\b/i;
const MALE_WORDS = /\b(mr|sir|dad|father|papa|man|boy|lord|king|prince|duke|count|brother|uncle|grandpa|husband|son|waiter|actor|he|officer|detective|doctor|dr|narrator)\b/i;
const FEM_NAMES = new Set('mara anna emma olivia sophia isabella mia charlotte amelia harper evelyn abigail emily ella elizabeth sofia avery scarlett grace chloe victoria riley aria lily aubrey zoey penelope lillian addison layla natalie camila hannah brooklyn zoe nora leah savannah audrey claire eleanor skylar ellie samantha stella paisley violet mila allison alexa anna hazel aaliyah ariana lucy sarah kate katie kathy jane julia julie lisa laura mary maria nina rose ruth sally susan tina vera wendy alice amy beth cora diane donna edith fiona gina helen irene jenny joan karen kim linda lois lucia margaret martha nancy nell paula rachel rebecca rita sandra sue tracy ursula val vivian willow maggie molly polly daisy ivy iris jess jessica jen jennifer megan nicole kylie lauren holly hayley bella'.split(' '));
const MALE_NAMES = new Set('jonah james john robert michael william david richard joseph thomas charles daniel matthew anthony mark paul steven andrew kenneth joshua kevin brian george edward ronald timothy jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel frank gregory raymond alexander patrick jack dennis jerry tyler aaron henry adam douglas nathan peter zachary kyle walter harold carl arthur gerald roger keith jeremy terry lawrence sean christian albert joe ethan austin jesse willie billy bruce bryan ralph roy eugene randy vincent russell louis philip bobby johnny bill tom tim tony jim jimmy bob ben sam max leo oscar hugh felix victor liam noah oliver lucas mason logan finn jake luke dan danny harry charlie freddie archie alfie'.split(' '));

export function guessGender(name) {
  const n = name.toLowerCase().replace(/[^a-z ]/g, ' ').trim();
  if (FEM_WORDS.test(n)) return 'f';
  if (MALE_WORDS.test(n)) return 'm';
  for (const w of n.split(/\s+/)) {
    if (FEM_NAMES.has(w)) return 'f';
    if (MALE_NAMES.has(w)) return 'm';
  }
  return null;
}

// Gives every character a distinct voice, matching gender when the name makes it clear.
export function assignVoices(names, lang = 'en-US') {
  const uniq = [...new Set(names)];
  const pools = { f: [...FEMALE], m: [...MALE] };
  if (lang === 'en-GB') for (const k of ['f', 'm']) pools[k].sort((a, b) => (b[0] === 'b') - (a[0] === 'b'));
  const out = {};
  let flip = 0;
  const take = (g) => {
    const pool = pools[g];
    return NEURAL_PREFIX + (pool.length ? pool.shift() : (g === 'f' ? FEMALE : MALE)[0]);
  };
  for (const n of uniq) if (guessGender(n)) out[n] = take(guessGender(n));
  for (const n of uniq) if (!out[n]) out[n] = take(['f', 'm'][flip++ % 2]);
  return out;
}
