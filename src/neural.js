// Optional natural voices: Kokoro-82M running fully in the browser (lazy loaded).
export const NEURAL_PREFIX = 'kokoro:';

const NAMES = {
  af_heart: 'Heart', af_bella: 'Bella', af_nicole: 'Nicole', af_sarah: 'Sarah', af_sky: 'Sky', af_nova: 'Nova', af_jessica: 'Jessica', af_alloy: 'Alloy',
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

function playBuffer(samples, rate, token) {
  return new Promise((resolve) => {
    if (token !== playToken) return resolve(false);
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const buf = ctx.createBuffer(1, samples.length, rate);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    current = src;
    src.onended = () => resolve(token === playToken);
    src.start();
  });
}

// Resolves true when finished, false if cancelled.
export async function speakNeural(text, voiceURI, { rate = 1, pitchless = true } = {}) {
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
    const ok = await playBuffer(audio.audio, audio.sampling_rate, token);
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
