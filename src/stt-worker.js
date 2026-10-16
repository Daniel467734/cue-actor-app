// On-device speech recognition (Whisper tiny) running off the main thread.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
let asr = null;

const load = (opts, id) =>
  pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
    ...opts,
    progress_callback: (p) => {
      if (p.status === 'progress') postMessage({ id, progress: Math.round(p.progress || 0) });
    },
  });

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      asr = await load({ dtype: 'q8', device: 'wasm' }, id);
      postMessage({ id, done: true });
    } else if (type === 'transcribe') {
      const out = await asr(data.audio, { chunk_length_s: 30 });
      postMessage({ id, done: true, text: (out.text || '').trim() });
    }
  } catch (e) {
    postMessage({ id, error: String(e?.message || e) });
  }
};
