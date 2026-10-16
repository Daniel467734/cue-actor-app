// Android/iOS app: the phone's own speech recogniser through Capacitor.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

const BeepMute = registerPlugin('BeepMute');
export const isNative = Capacitor.isNativePlatform();

export class NativeListener {
  constructor({ lang = 'en-US', onText = () => {}, onFinal = () => {}, onState = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { lang, onText, onFinal, onState, onError });
    this.wanted = false;
    this.running = false;
    this.committed = '';
    this.current = '';
    this.epoch = 0;
    this.handle = null;
  }

  async start() {
    this.wanted = true;
    if (!this.handle) {
      this.handle = await SpeechRecognition.addListener('partialResults', (d) => {
        if (!this.wanted) return;
        this.current = (d.matches && d.matches[0]) || '';
        this.#emit();
      });
    }
    const perm = await SpeechRecognition.requestPermissions().catch(() => null);
    if (perm && perm.speechRecognition !== 'granted') {
      this.wanted = false;
      this.onError('Microphone permission was denied. Allow it in the phone settings.');
      return;
    }
    BeepMute.mute().catch(() => {});
    this.#loop();
  }

  async #loop() {
    if (this.running || !this.wanted) return;
    this.running = true;
    const epoch = this.epoch;
    let fails = 0;
    while (this.wanted && epoch === this.epoch) {
      const t0 = Date.now();
      try {
        const r = await SpeechRecognition.start({ language: this.lang, partialResults: true, popup: false, maxResults: 1 });
        if (epoch === this.epoch && r?.matches?.[0]) this.current = r.matches[0];
      } catch { /* session ended with no speech */ }
      if (epoch !== this.epoch) break;
      if (this.current) {
        this.committed = `${this.committed} ${this.current}`.trim();
        this.current = '';
        this.#emit();
      }
      fails = Date.now() - t0 < 400 ? fails + 1 : 0;
      await new Promise((r) => setTimeout(r, Math.min(1500, 30 + fails * 150)));
    }
    this.running = false;
  }

  #emit() {
    this.onText(`${this.committed} ${this.current}`.trim());
  }

  resetTurn() {
    this.committed = '';
    this.current = '';
  }

  pause() {
    this.wanted = false;
    this.epoch++;
    this.resetTurn();
    SpeechRecognition.stop().catch(() => {});
    BeepMute.unmute().catch(() => {});
  }

  resume() {
    this.resetTurn();
    this.wanted = true;
    this.epoch++;
    this.running = false;
    BeepMute.mute().catch(() => {});
    this.#loop();
  }

  stop() {
    this.pause();
    this.handle?.remove();
    this.handle = null;
  }
}
