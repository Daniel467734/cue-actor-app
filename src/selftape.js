import { h } from './util.js';
import { audioTap } from './neural.js';

const pickType = () => ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) => window.MediaRecorder?.isTypeSupported(t)) || '';

// Records the camera, your mic and the scene partner's voice.
// full: you + the clean partner voice (your mic is muted while the partner speaks, so the room echo is replaced by the real voice).
// cut: only you; the recording pauses while the partner speaks.
export async function startSelfTape(parent) {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) throw new Error('Self-tape needs a newer browser');
  const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: { echoCancellation: true, noiseSuppression: true } });
  const { ctx, dest } = audioTap();
  if (ctx.state === 'suspended') ctx.resume();
  const micSrc = ctx.createMediaStreamSource(new MediaStream(cam.getAudioTracks()));
  const micGain = ctx.createGain();
  const cutDest = ctx.createMediaStreamDestination();
  micSrc.connect(micGain);
  micGain.connect(dest);
  micSrc.connect(cutDest);
  const type = pickType();
  const make = (audio) => {
    const rec = new MediaRecorder(new MediaStream([...cam.getVideoTracks(), ...audio.stream.getAudioTracks()]), type ? { mimeType: type } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    return { rec, chunks };
  };
  const full = make(dest);
  const cut = make(cutDest);
  const preview = h('video', { class: 'selftape-preview', muted: true, autoplay: true, playsinline: true });
  preview.muted = true;
  preview.srcObject = new MediaStream(cam.getVideoTracks());
  parent.append(preview);
  full.rec.start(1000);
  cut.rec.start(1000);
  const cleanup = () => {
    preview.remove();
    micSrc.disconnect();
    micGain.disconnect();
    cam.getTracks().forEach((t) => t.stop());
  };
  const finish = (r) => new Promise((resolve) => {
    if (r.rec.state === 'inactive') return resolve(null);
    r.rec.onstop = () => resolve(r.chunks.length ? new Blob(r.chunks, { type: r.rec.mimeType || type || 'video/webm' }) : null);
    r.rec.stop();
  });
  return {
    partner: (speaking) => {
      micGain.gain.value = speaking ? 0 : 1;
      try {
        if (speaking && cut.rec.state === 'recording') cut.rec.pause();
        else if (!speaking && cut.rec.state === 'paused') cut.rec.resume();
      } catch { /* pause unsupported */ }
    },
    stop: async () => {
      if (cut.rec.state === 'paused') cut.rec.resume();
      const [f, c] = await Promise.all([finish(full), finish(cut)]);
      cleanup();
      return { full: f, cut: c };
    },
    discard: () => {
      for (const r of [full, cut]) {
        try {
          r.rec.onstop = null;
          if (r.rec.state !== 'inactive') r.rec.stop();
        } catch { /* already stopped */ }
      }
      cleanup();
    },
  };
}

export function selfTapePanel(video, title, character) {
  const clip = (blob, label, suffix) => {
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const name = `${title} - ${character} ${suffix}.${ext}`.replace(/[^\w .-]/g, '');
    const file = new File([blob], name, { type: blob.type });
    const url = URL.createObjectURL(blob);
    const canShare = navigator.canShare?.({ files: [file] });
    return h('div', { class: 'tape-clip' },
      h('h4', {}, label),
      h('video', { controls: true, playsinline: true, src: url, class: 'selftape-video' }),
      h('div', { class: 'row wrap gap' },
        h('a', { class: 'btn gold', href: url, download: name }, 'Save'),
        canShare && h('button', { class: 'btn', onclick: () => navigator.share({ files: [file], title: name }).catch(() => {}) }, 'Share')));
  };
  return h('div', { class: 'panel' },
    h('h3', {}, '🎥 Your self-tape'),
    clip(video.full, 'Full scene (with the partner\'s voice)', 'self-tape'),
    video.cut && clip(video.cut, 'Cut: just you (partner lines removed)', 'cut'),
    h('small', { class: 'muted' }, 'Not stored in the app. Save to your device now. The partner voice is the clean natural voice, not the room echo. Fallback voices can\'t be captured.'));
}
