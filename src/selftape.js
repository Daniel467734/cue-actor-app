import { h } from './util.js';
import { audioTap } from './neural.js';

const pickType = () => ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) => window.MediaRecorder?.isTypeSupported(t)) || '';

// Records camera plus your mic and the scene partner's voice. Returns { stop, discard }.
export async function startSelfTape(parent) {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) throw new Error('Self-tape needs a newer browser');
  const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: { echoCancellation: true, noiseSuppression: true } });
  const { ctx, dest } = audioTap();
  if (ctx.state === 'suspended') ctx.resume();
  const micSrc = ctx.createMediaStreamSource(new MediaStream(cam.getAudioTracks()));
  micSrc.connect(dest);
  const stream = new MediaStream([...cam.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = pickType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const preview = h('video', { class: 'selftape-preview', muted: true, autoplay: true, playsinline: true });
  preview.muted = true;
  preview.srcObject = new MediaStream(cam.getVideoTracks());
  parent.append(preview);
  rec.start(1000);
  const cleanup = () => {
    preview.remove();
    micSrc.disconnect();
    cam.getTracks().forEach((t) => t.stop());
  };
  return {
    stop: () => new Promise((resolve) => {
      if (rec.state === 'inactive') return resolve(null);
      rec.onstop = () => {
        cleanup();
        resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || type || 'video/webm' }) : null);
      };
      rec.stop();
    }),
    discard: () => {
      try {
        rec.onstop = null;
        if (rec.state !== 'inactive') rec.stop();
      } catch { /* already stopped */ }
      cleanup();
    },
  };
}

export function selfTapePanel(blob, title, character) {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const name = `${title} - ${character} self-tape.${ext}`.replace(/[^\w .-]/g, '');
  const file = new File([blob], name, { type: blob.type });
  const url = URL.createObjectURL(blob);
  const canShare = navigator.canShare?.({ files: [file] });
  return h('div', { class: 'panel' },
    h('h3', {}, '🎥 Your self-tape'),
    h('video', { controls: true, playsinline: true, src: url, class: 'selftape-video' }),
    h('div', { class: 'row wrap gap' },
      h('a', { class: 'btn gold', href: url, download: name }, 'Save video'),
      canShare && h('button', { class: 'btn', onclick: () => navigator.share({ files: [file], title: name }).catch(() => {}) }, 'Share')),
    h('small', { class: 'muted' }, 'Not stored in the app. Save it to your device now. Voices from the built-in fallback can\'t be captured, only natural voices.'));
}
