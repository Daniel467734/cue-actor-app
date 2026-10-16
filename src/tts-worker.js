// Runs Kokoro off the main thread so the UI and speech recognition stay responsive.
import { KokoroTTS } from 'kokoro-js';

let tts = null;

const load = (opts, id) =>
  KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    ...opts,
    progress_callback: (p) => {
      if (p.status === 'progress') postMessage({ id, progress: Math.round(p.progress || 0) });
    },
  });

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      tts = await load(data.opts, id).catch(() => load({ dtype: 'q8', device: 'wasm' }, id));
      postMessage({ id, done: true });
    } else if (type === 'generate') {
      const t0 = performance.now();
      const out = await tts.generate(data.text, { voice: data.voice, speed: data.speed });
      const audio = out.audio;
      console.log('TTSDBG chars=' + data.text.length + ' genMs=' + Math.round(performance.now() - t0) + ' audioSec=' + (audio.length / out.sampling_rate).toFixed(1));
      postMessage({ id, done: true, audio, sampling_rate: out.sampling_rate }, [audio.buffer]);
    }
  } catch (e) {
    postMessage({ id, error: String(e?.message || e) });
  }
};
