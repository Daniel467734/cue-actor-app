// Speech recognition, speech synthesis, and mic recording helpers (all browser built-ins).

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;
export const ttsSupported = 'speechSynthesis' in window;

export class Listener {
  constructor({ lang = 'en-US', onText = () => {}, onFinal = () => {}, onState = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { lang, onText, onFinal, onState, onError });
    this.wanted = false;
    this.running = false;
    this.base = 0;
    this.len = 0;
    this.stash = '';
    this.lastText = '';
  }

  start() {
    this.wanted = true;
    this.#begin();
  }

  #begin() {
    if (!SR || this.running || !this.wanted) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = this.lang;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      this.len = e.results.length;
      let text = '';
      for (let i = this.base; i < e.results.length; i++) text += `${e.results[i][0].transcript} `;
      this.lastText = text.trim();
      this.onText(`${this.stash} ${this.lastText}`.trim());
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal && i >= this.base) this.onFinal(e.results[i][0].transcript.trim());
      }
    };
    r.onstart = () => this.onState('listening');
    r.onend = () => {
      this.running = false;
      this.stash = `${this.stash} ${this.lastText}`.trim();
      this.lastText = '';
      this.base = 0;
      this.len = 0;
      this.onState('idle');
      if (this.wanted) setTimeout(() => this.#begin(), 120);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wanted = false;
        this.onError('Microphone access was blocked. Allow the mic in your browser settings and try again.');
      } else if (e.error === 'audio-capture') {
        this.wanted = false;
        this.onError('No microphone found.');
      } else if (e.error === 'network') {
        this.onError('Speech recognition needs an internet connection in this browser.');
      }
    };
    this.rec = r;
    try {
      r.start();
      this.running = true;
    } catch {
      /* already started */
    }
  }

  // Ignore everything heard so far (new turn).
  resetTurn() {
    this.base = this.len;
    this.stash = '';
    this.lastText = '';
  }

  pause() {
    this.wanted = false;
    try {
      this.rec?.abort();
    } catch {
      /* noop */
    }
    this.running = false;
    this.base = 0;
    this.len = 0;
    this.stash = '';
    this.lastText = '';
  }

  resume() {
    this.base = 0;
    this.len = 0;
    this.stash = '';
    this.lastText = '';
    this.wanted = true;
    if (!this.running) this.#begin();
  }

  stop() {
    this.pause();
  }
}

/* ---------------- Text to speech ---------------- */

let voicesCache = [];
export function getVoices() {
  return new Promise((resolve) => {
    if (!ttsSupported) return resolve([]);
    const load = () => {
      voicesCache = speechSynthesis.getVoices();
      return voicesCache;
    };
    const v = load();
    if (v.length) return resolve(v);
    speechSynthesis.addEventListener('voiceschanged', () => resolve(load()), { once: true });
    setTimeout(() => resolve(load()), 1500);
  });
}

const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

export function voiceScore(v, lang = 'en-US') {
  const n = v.name;
  let s = 0;
  if (NOVELTY.test(n)) return -100;
  if (/premium|enhanced|neural|natural|online|siri/i.test(n)) s += 50;
  if (/google/i.test(n)) s += 25;
  if (/espeak|compact/i.test(n)) s -= 40;
  if (/microsoft/i.test(n) && !/online|natural/i.test(n)) s -= 10;
  if (v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase()) s += 20;
  if (!v.localService) s += 5;
  return s;
}

export const rankVoices = (voices, lang = 'en-US') =>
  voices
    .filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()))
    .map((v) => ({ v, s: voiceScore(v, lang) }))
    .filter((x) => x.s > -50)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);

export function voiceLabel(v, lang) {
  const sc = voiceScore(v, lang);
  return `${sc >= 50 ? '★ ' : ''}${v.name} (${v.lang})`;
}

// Picks from the best few voices so each character sounds distinct yet natural.
export function autoVoice(name, voices, lang = 'en-US') {
  const ranked = rankVoices(voices, lang);
  const list = ranked.length ? ranked : voices;
  if (!list.length) return { uri: '', pitch: 1 };
  const top = list[0] ? voiceScore(list[0], lang) : 0;
  const best = list.filter((v) => voiceScore(v, lang) >= top - 15).slice(0, 6);
  const h = hash(name);
  return { uri: best[h % best.length].voiceURI, pitch: 0.92 + ((h >> 3) % 5) * 0.04 };
}

let speakToken = 0;

function chunk(text) {
  const parts = text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 160 && cur) {
      out.push(cur);
      cur = p;
    } else cur += p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Resolves true when finished, false if cancelled.
export function speak(text, { voiceURI = '', rate = 1, pitch = 1, expressive = true } = {}) {
  if (!ttsSupported || !text.trim()) return Promise.resolve(true);
  const token = ++speakToken;
  speechSynthesis.cancel();
  const voice = voicesCache.find((v) => v.voiceURI === voiceURI);
  const pieces = chunk(text.replace(/\s+/g, ' '));
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (token !== speakToken) return resolve(false);
      if (i >= pieces.length) return resolve(true);
      const piece = pieces[i++];
      const u = new SpeechSynthesisUtterance(piece);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      let p = pitch;
      let r = rate;
      if (expressive) {
        if (/!\s*$/.test(piece)) {
          p += 0.08;
          r *= 1.06;
        } else if (/\?\s*$/.test(piece)) p += 0.1;
        else if (/\.\.\.|…/.test(piece)) r *= 0.9;
      }
      u.pitch = Math.min(2, p);
      u.rate = Math.min(2, Math.max(0.5, r));
      u.onend = next;
      u.onerror = () => (token === speakToken ? next() : resolve(false));
      speechSynthesis.speak(u);
    };
    next();
  });
}

export function cancelSpeech() {
  speakToken++;
  if (ttsSupported) speechSynthesis.cancel();
}

/* ---------------- Mic level + recording ---------------- */

export class MicMonitor {
  constructor() {
    this.stream = null;
    this.chunks = [];
  }

  async start({ record = true } = {}) {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return false;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      this.buf = new Uint8Array(this.analyser.fftSize);
    } catch {
      /* meter optional */
    }
    if (record && 'MediaRecorder' in window) {
      try {
        this.rec = new MediaRecorder(this.stream);
        this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
        this.rec.start(1000);
      } catch {
        this.rec = null;
      }
    }
    return true;
  }

  level() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }

  stop() {
    return new Promise((resolve) => {
      const finish = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.ctx?.close().catch(() => {});
        resolve(this.chunks.length ? new Blob(this.chunks, { type: this.rec?.mimeType || 'audio/webm' }) : null);
      };
      if (this.rec && this.rec.state !== 'inactive') {
        this.rec.onstop = finish;
        this.rec.stop();
      } else finish();
    });
  }
}

export function chime(freq = 880, ms = 90) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.value = 0.05;
    o.connect(g).connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, ms);
  } catch {
    /* noop */
  }
}
