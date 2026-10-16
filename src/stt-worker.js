// On-device speech recognition (Whisper tiny) running off the main thread.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
let asr = null;
console.log('STTDBG isolated=' + self.crossOriginIsolated + ' gpu=' + !!navigator.gpu + ' cores=' + navigator.hardwareConcurrency);

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
      try {
        if (!navigator.gpu) throw new Error('no webgpu');
        asr = await load({ dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, device: 'webgpu' }, id);
        await asr(new Float32Array(16000));
        console.log('STTDBG backend=webgpu');
      } catch (e) {
        console.log('STTDBG webgpu failed: ' + e);
        asr = await load({ dtype: 'q8', device: 'wasm' }, id);
        console.log('STTDBG backend=wasm');
      }
      postMessage({ id, done: true });
    } else if (type === 'transcribe') {
      const t0 = performance.now();
      const out = await asr(data.audio, { chunk_length_s: 30 });
      console.log('STTDBG transcribe ms=' + Math.round(performance.now() - t0) + ' audioSec=' + (data.audio.length / 16000).toFixed(1));
      postMessage({ id, done: true, text: (out.text || '').trim() });
    }
  } catch (e) {
    postMessage({ id, error: String(e?.message || e) });
  }
};
