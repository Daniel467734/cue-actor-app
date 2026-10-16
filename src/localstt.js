// Always-on listening: the mic stays open (no start/stop beeps) and a small on-device model transcribes each spoken phrase.
let worker = null;
let seq = 0;
const pending = new Map();
let loading = null;
let ready = false;

function call(msg, onProgress, transfer = []) {
  worker = worker || Object.assign(new Worker(new URL('./stt-worker.js', import.meta.url), { type: 'module' }), {
    onmessage: ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      if (data.progress != null) return p.onProgress?.(data.progress);
      pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data);
    },
  });
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

export const sttReady = () => ready;
export let sttPct = 0;

export function loadStt(onProgress) {
  if (ready) return Promise.resolve();
  if (!loading) {
    loading = call({ type: 'load' }, (p) => { sttPct = p; onProgress?.(p); })
      .then(() => { ready = true; })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

const clean = (t) => {
  const c = t.replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(you|\.+|thank you\.?)$/i.test(c) ? '' : c;
};

export class LocalListener {
  constructor({ onText = () => {}, onFinal = () => {}, onState = () => {}, onError = () => {}, onUnavailable = () => {} } = {}) {
    Object.assign(this, { onText, onFinal, onState, onError, onUnavailable });
    this.active = false;
    this.opened = false;
    this.ring = [];
    this.buf = [];
    this.speaking = false;
    this.lastVoice = 0;
    this.busy = false;
    this.committed = '';
    this.current = '';
    this.epoch = 0;
    this.floor = 0.003;
  }

  async start() {
    this.active = true;
    if (this.opened) return;
    this.opened = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      this.opened = false;
      this.active = false;
      this.onError('Microphone access was blocked. Allow the mic in your browser settings and try again.');
      return;
    }
    try {
      await loadStt();
    } catch {
      this.stop();
      this.onUnavailable();
      return;
    }
    if (!this.opened) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.ctx.resume?.();
    this.rate = this.ctx.sampleRate;
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.proc.onaudioprocess = (e) => this.#frame(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(this.proc);
    this.proc.connect(mute);
    mute.connect(this.ctx.destination);
    this.timer = setInterval(() => this.#interim(), 250);
    this.onState('listening');
  }

  #frame(f) {
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / f.length);
    const now = Date.now();
    this.ring.push(f);
    if (this.ring.length > 8) this.ring.shift();
    if (!this.active) return;
    if (!this.speaking) this.floor = Math.min(0.02, this.floor * 0.97 + rms * 0.03);
    const loud = rms > Math.max(0.006, this.floor * 2.5);
    if (loud) this.lastVoice = now;
    if (loud && !this.speaking) {
      this.speaking = true;
      this.buf = [...this.ring];
    } else if (this.speaking) {
      this.buf.push(f);
    }
    if (this.speaking) {
      const secs = (this.buf.length * f.length) / this.rate;
      if (now - this.lastVoice > 600 || secs > 25) this.#finalize();
    }
  }

  #audio() {
    const len = this.buf.reduce((a, b) => a + b.length, 0);
    const all = new Float32Array(len);
    let o = 0;
    for (const b of this.buf) {
      all.set(b, o);
      o += b.length;
    }
    return this.rate === 16000 ? all : resample(all, this.rate, 16000);
  }

  async #transcribe() {
    const audio = this.#audio();
    const r = await call({ type: 'transcribe', audio }, null, [audio.buffer]);
    return clean(r.text);
  }

  async #interim() {
    if (!this.active || !this.speaking || this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    const frames = this.buf.length;
    try {
      const text = await this.#transcribe();
      this.doneFrames = frames;
      if (epoch === this.epoch && this.speaking) {
        this.current = text;
        this.#emit();
      }
    } catch { /* keep listening */ }
    this.busy = false;
  }

  async #finalize() {
    const epoch = this.epoch;
    this.speaking = false;
    const had = this.buf.length;
    while (this.busy) await new Promise((r) => setTimeout(r, 40));
    if (!had || epoch !== this.epoch) return;
    this.busy = true;
    try {
      // Reuse the last live transcript if almost no new audio arrived since it.
      const fresh = this.current && this.buf.length - (this.doneFrames || 0) <= 4;
      const text = fresh ? this.current : await this.#transcribe();
      if (epoch === this.epoch) {
        this.committed = `${this.committed} ${text}`.trim();
        this.current = '';
        this.buf = [];
        this.#emit();
        this.onFinal(text);
      }
    } catch { /* ignore */ }
    this.busy = false;
  }

  #emit() {
    this.onText(`${this.committed} ${this.current}`.trim());
  }

  // Forget everything heard so far (new turn). The mic stays open.
  resetTurn() {
    this.epoch++;
    this.committed = '';
    this.current = '';
    this.speaking = false;
    this.buf = [];
    this.doneFrames = 0;
    this.lastVoice = 0;
  }

  pause() {
    this.active = false;
    this.resetTurn();
  }

  resume() {
    this.resetTurn();
    this.active = true;
    this.#revive();
  }

  // Phones can suspend the audio context or mute the mic while other audio plays.
  async #revive() {
    try {
      const track = this.stream?.getAudioTracks()[0];
      if (!this.stream || !track || track.readyState !== 'live') {
        this.stop();
        this.active = true;
        await this.start();
        return;
      }
      if (this.ctx?.state !== 'running') await this.ctx.resume();
    } catch { /* retry next turn */ }
  }

  stop() {
    this.active = false;
    this.opened = false;
    this.epoch++;
    clearInterval(this.timer);
    try {
      this.proc?.disconnect();
      this.ctx?.close();
    } catch { /* closed */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

function resample(data, from, to) {
  const ratio = from / to;
  const out = new Float32Array(Math.floor(data.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(data.length - 1, i0 + 1);
    out[i] = data[i0] + (data[i1] - data[i0]) * (pos - i0);
  }
  return out;
}
