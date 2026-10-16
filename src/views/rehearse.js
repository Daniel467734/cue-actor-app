import { lineMemory, dueLineIds } from '../stats.js';
import { startSelfTape, selfTapePanel } from '../selftape.js';
import { deliveryFor } from '../delivery.js';
import { loadNeural, unlockAudio } from '../neural.js';
import { NativeListener, isNative } from '../nativestt.js';
import { LocalListener, loadStt, sttReady, sttPct } from '../localstt.js';
import { h, toast, formatDuration } from '../util.js';
import { getScript, saveSession, saveRecording, sessionsFor, getSettings } from '../store.js';
import { Listener, MicMonitor, speak, cancelSpeech, getVoices, autoVoice, sttSupported, chime, prefetchSpeech, isMobile, ttsSupported } from '../speech.js';
import { matchLine, displayWords, hintFrom, detectCommand, tokenize, stripDirections } from '../matcher.js';
import { troubleLineIds, summarize, lastResultPerLine, STATUS } from '../stats.js';
import { keepAwake } from '../wake.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const signal = () => {
  let resolve;
  const p = new Promise((r) => (resolve = r));
  return { p, resolve };
};

export async function render(root, { id }) {
  const script = await getScript(id);
  const run = JSON.parse(sessionStorage.getItem('cue-run') || 'null');
  if (!script || !run || run.scriptId !== id) {
    location.hash = `#/script/${id}`;
    return () => {};
  }
  const S = { ...getSettings(), ...run.options };
  const me = run.character;
  const voices = await getVoices();
  // Load the voice and render the first partner lines while the intro screen is showing.
  const loadP = loadNeural().catch(() => {});
  const level = S.strictness;

  // Build the queue of lines to play.
  let startIdx = Math.max(0, script.items.findIndex((i) => i.id === run.startId));
  if (run.startId == null) startIdx = 0;
  let queue = script.items.slice(startIdx);
  if (run.sceneOnly && run.startId != null && run.mode === 'full') {
    const end = queue.findIndex((q, k) => k > 0 && q.type === 'scene');
    if (end > 0) queue = queue.slice(0, end);
  }
  if (run.mode === 'trouble') {
    const sessions = await sessionsFor(script.id);
    const bad = new Set(troubleLineIds(sessions, me));
    const keep = new Set();
    script.items.forEach((it, k) => {
      if (bad.has(it.id)) {
        keep.add(k);
        for (let b = k - 1; b >= 0 && b >= k - 2; b--) {
          keep.add(b);
          if (script.items[b].type === 'dialogue') break;
        }
      }
    });
    queue = script.items.filter((_, k) => keep.has(k));
  }
  const allSessions = await sessionsFor(script.id);
  const memory = lineMemory(allSessions, me);
  if (run.mode === 'due') {
    const due = new Set(dueLineIds(allSessions, me, script.items));
    const keep = new Set();
    script.items.forEach((it, k) => {
      if (due.has(it.id)) {
        keep.add(k);
        for (let b = k - 1; b >= 0 && b >= k - 2; b--) {
          keep.add(b);
          if (script.items[b].type === 'dialogue') break;
        }
      }
    });
    queue = script.items.filter((_, k) => keep.has(k));
    if (!queue.length) toast('Nothing due. You are all caught up!', 4000);
  }
  if (!queue.some((q) => q.type === 'dialogue' && q.character === me)) {
    toast('No lines for that character in this selection.');
    location.hash = `#/script/${id}`;
    return () => {};
  }

  const voiceFor = (name) => {
    const saved = script.voices?.[name];
    if (saved) return { voiceURI: saved, pitch: 1 };
    const a = autoVoice(name, voices, S.lang, [...new Set(script.items.map((i) => i.character).filter(Boolean))]);
    return { voiceURI: a.uri, pitch: a.pitch };
  };
  const narrator = () => {
    if (S.narratorURI) return { voiceURI: S.narratorURI, pitch: 1 };
    return voiceFor('NARRATOR');
  };
  const say = (text, v) => speak(text, { ...v, rate: S.speechRate, expressive: S.expressive });

  /* ---------- UI ---------- */
  const progressFill = h('i');
  const counts = { ok: h('b', {}, '0'), prompted: h('b', {}, '0'), missed: h('b', {}, '0') };
  const context = h('div', { class: 'context' });
  const card = h('div', { class: 'card-line' });
  const statusEl = h('div', { class: 'status' });
  const levelBar = h('div', { class: 'level' }, h('i'));
  const transcript = h('div', { class: 'heard' });
  const spot = h('div', { class: 'spot' });
  const promptBtn = h('button', { class: 'btn prompt-btn', onclick: () => act('prompt') }, h('span', {}, '💡'), 'Prompt');
  const pauseBtn = h('button', { class: 'btn', onclick: () => act('pause') }, '⏸ Pause');
  const hideBtn = h('button', { class: 'btn ghost small', onclick: cycleHide }, '');
  const controls = h('div', { class: 'controls' },
    h('button', { class: 'btn', onclick: () => act('back') }, '⏮ Back'),
    promptBtn,
    h('button', { class: 'btn', onclick: () => act('done') }, '✓ Got it'),
    h('button', { class: 'btn', onclick: () => act('skip') }, 'Skip ⏭'),
  );
  const stage = h('div', { class: 'rehearse-stage' },
    h('div', { class: 'r-top' },
      h('button', { class: 'icon-btn', 'aria-label': 'End rehearsal', onclick: () => act('stop') }, '✕'),
      h('div', { class: 'r-title' }, h('b', {}, script.title), h('span', {}, `You: ${me}`)),
      h('div', { class: 'r-counts', title: 'clean / prompted / missed' }, '✓', counts.ok, ' 💡', counts.prompted, ' ✗', counts.missed)),
    h('div', { class: 'progress' }, progressFill),
    spot, context, card, statusEl, transcript,
    h('div', { class: 'r-bottom' }, levelBar, controls, h('div', { class: 'row center gap' }, pauseBtn, hideBtn)));
  spot.append(h('div', { class: 'beam' }));

  const setHideLabel = () => (hideBtn.textContent = `Lines: ${{ show: 'visible', first: 'first words', hidden: 'hidden', learn: 'smart fade' }[S.hideMode]}`);
  function cycleHide() {
    S.hideMode = { show: 'first', first: 'hidden', hidden: 'learn', learn: 'show' }[S.hideMode];
    setHideLabel();
    if (turnUI) turnUI.refresh();
  }
  setHideLabel();

  const intro = h('div', { class: 'overlay intro' },
    h('div', { class: 'dialog center' },
      h('h2', {}, `Places, ${me}.`),
      h('p', {}, sttSupported
        ? 'The app will read the other parts and listen for your lines. Say "prompt" (or wait) if you need help. Headphones work best.'
        : 'Speech recognition isn\'t available in this browser, so use the buttons to move through your lines. Chrome, Edge or Safari give the full experience.'),
      h('button', { class: 'btn gold big', onclick: () => begin() }, '🎬 Action!')));

  root.replaceChildren(stage, intro);

  /* ---------- state ---------- */
  const results = [];
  const startedAt = Date.now();
  const mic = new MicMonitor();
  let release = () => {};
  let tape = null;
  let cancelReady = null;
  let meterRaf;
  let ended = false;
  let current = null; // signal for the current wait
  let acceptInput = false;
  let onText = null;
  let turnUI = null;
  let i = 0;
  let resumeSig = null;
  let destroyed = false;
  let started = false;

  const useModel = S.sttEngine === 'local' || (isNative && S.sttEngine !== 'native');
  const useLocal = useModel || (isNative && S.sttEngine === 'native');
  const listenerOpts = {
    lang: S.lang,
    onText: (t) => acceptInput && onText?.(t, false),
    onFinal: () => {},
    onError: (m) => toast(m, 4500),
  };
  let listener = !useModel && isNative
    ? new NativeListener(listenerOpts)
    : useModel
    ? new LocalListener({
      ...listenerOpts,
      onUnavailable: () => {
        toast('On-device listening couldn\'t load, using the browser\'s instead', 4500);
        listener = new Listener(listenerOpts);
        listener.start();
      },
    })
    : new Listener(listenerOpts);
  let sttFailed = false;
  // Load one model at a time; two at once can exhaust a phone's memory.
  if (useModel) loadP.then(() => loadStt()).catch(() => { sttFailed = true; });
  // Treat a short silence after the last result as the end of an utterance.
  function act(a) {
    current?.resolve(a);
  }
  const onKey = (e) => {
    if (e.target.closest('input,textarea,[contenteditable]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      act('prompt');
    } else if (e.key === 'ArrowRight') act('skip');
    else if (e.key === 'ArrowLeft') act('back');
    else if (e.key === 'Escape') act('stop');
  };
  window.addEventListener('keydown', onKey);

  const warm = loadP.then(() => prefetchAhead(0)).catch(() => {});

  function begin() {
    intro.remove();
    started = true;
    unlockAudio();
    if (ttsSupported) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    keepAwake().then((r) => { if (destroyed) r(); else release = r; });
    if (useLocal) listener.start();
    else if (sttSupported && !isMobile) listener.start();
    // Phones can't share the mic between speech recognition and a second stream, so skip the meter/recording there.
    (isMobile || useLocal ? Promise.resolve(false) : mic.start({ record: S.record && !isMobile })).then((ok) => {
      if (!ok || destroyed) return;
      const tick = () => {
        levelBar.firstChild.style.transform = `scaleX(${acceptInput ? mic.level() : 0})`;
        meterRaf = requestAnimationFrame(tick);
      };
      tick();
    });
    setStatus('Warming up the voices…');
    Promise.race([warm, sleep(20000)]).then(async () => {
      const t0 = Date.now();
      while (useModel && !sttFailed && !sttReady() && !destroyed && Date.now() - t0 < 120000) {
        setStatus(`Loading listening model… ${sttPct}% (first time only)`);
        await sleep(500);
      }
      if (useModel && !sttReady() && !destroyed) {
        toast('Listening model is too slow here, using the browser\'s listening', 4500);
        listener.stop();
        listener = new Listener(listenerOpts);
        listener.start();
      }
    if (S.selftape) {
      if (useLocal) listener.onStream = (st) => tape?.setMic(st);
      setStatus('Getting ready…');
      await new Promise((resolve) => {
        const ov = h('div', { class: 'overlay' },
          h('div', { class: 'dialog center' }, h('h2', {}, 'Ready to record?'),
            h('p', { class: 'muted' }, 'Get in position. Recording starts when you tap.'),
            h('button', { class: 'btn gold', onclick: () => { ov.remove(); resolve(); } }, "I'm ready")));
        document.body.append(ov);
        cancelReady = () => { ov.remove(); resolve(); };
      });
      if (destroyed) return;
      try {
        for (let i = 0; i < 20 && useLocal && !listener.stream; i++) await sleep(250);
        const t = await startSelfTape(stage, useLocal ? listener.stream : null);
        if (destroyed) t?.discard();
        else tape = t;
      } catch (e) {
        toast(e.message || 'Camera unavailable', 4500);
      }
    }
      if (!destroyed) loop();
    });
  }

  /* ---------- rendering ---------- */
  function renderContext(k) {
    const prev = queue.slice(Math.max(0, k - 2), k);
    context.replaceChildren(...prev.map((p) => {
      const mine = p.type === 'dialogue' && p.character === me;
      return h('div', { class: `ctx ${p.type}${mine ? ' mine' : ''}` },
        p.type === 'dialogue' ? h('b', {}, `${p.character} `) : null, p.text);
    }));
    progressFill.style.width = `${(k / queue.length) * 100}%`;
  }

  function bumpCounts() {
    const s = summarize(results);
    counts.ok.textContent = s.ok;
    counts.prompted.textContent = s.prompted;
    counts.missed.textContent = s.missed;
  }

  function wordsEl(it, mineLine) {
    const dw = displayWords(it.text);
    const el = h('div', { class: 'words' });
    let n = 0;
    const spans = dw.map((w) => {
      if (w.token < 0) return document.createTextNode(w.text);
      const s = h('span', { class: 'w', dataset: { n: n++, t: w.token } }, w.text);
      return s;
    });
    el.append(...spans);
    return { el, spans: spans.filter((s) => s.dataset), total: n, mineLine };
  }

  // The UI for the actor's own line: reveal / highlight words as they are said.
  function makeTurnUI(it) {
    const w = wordsEl({ ...it, text: stripDirections(it.text).replace(/\s+/g, ' ').trim() }, true);
    const revealed = new Set();
    let matched = [];
    let finalState = null;
    function refresh() {
      w.spans.forEach((s) => {
        const n = Number(s.dataset.n);
        const t = Number(s.dataset.t);
        const hit = matched[t];
        const lvl = Math.min(4, memory.get(it.id)?.streak || 0);
        const fade = S.hideMode === 'learn' && ((lvl === 1 && n % 4 === 3) || (lvl === 2 && n % 2 === 1) || (lvl === 3 && n > 0) || lvl >= 4);
        const visible = finalState || S.hideMode === 'show' || (S.hideMode === 'learn' && !fade) || (S.hideMode === 'first' && n < 2) || hit || revealed.has(t);
        const word = s.dataset.word || (s.dataset.word = s.textContent);
        const clue = !visible && S.hideMode === 'learn' && lvl >= 2;
        s.textContent = clue ? word.replace(/[A-Za-z0-9]/g, (c, k) => (k === word.search(/[A-Za-z0-9]/) ? c : '_')) : word;
        s.classList.toggle('clue', clue);
        s.classList.toggle('hide', !visible && !clue);
        s.classList.toggle('hit', !!hit && !finalState);
        s.classList.toggle('miss', !!finalState && !hit && finalState !== 'ok');
        s.classList.toggle('hint', revealed.has(t) && !hit);
      });
    }
    refresh();
    return {
      el: w.el,
      refresh,
      setMatched(m) {
        matched = m;
        refresh();
      },
      reveal(from, count) {
        for (let k = from; k < from + count; k++) revealed.add(k);
        refresh();
      },
      revealAll() {
        for (let k = 0; k < 500; k++) revealed.add(k);
        refresh();
      },
      finish(status) {
        finalState = status;
        refresh();
      },
    };
  }

  function showCard(it, mine) {
    card.className = `card-line ${it.type}${mine ? ' mine' : ''}`;
    const children = [];
    if (it.type === 'dialogue') children.push(h('div', { class: 'who' }, mine ? `${it.character} · you` : it.character));
    else if (it.type === 'scene') children.push(h('div', { class: 'who' }, 'Scene'));
    if (mine) {
      turnUI = makeTurnUI(it);
      children.push(turnUI.el);
    } else {
      turnUI = null;
      children.push(h('div', { class: 'words' }, it.parenthetical ? `(${it.text})` : it.text));
    }
    card.replaceChildren(...children);
  }

  function setStatus(text, cls = '') {
    statusEl.textContent = text;
    statusEl.className = `status ${cls}`;
  }

  /* ---------- turns ---------- */
  const raceSig = async (promise, sig) => {
    const r = await Promise.race([promise.then(() => 'done'), sig.p]);
    return r;
  };

  async function partnerTurn(it) {
    if (isMobile || useLocal) listener.pause();
    acceptInput = false;
    onText = null;
    transcript.textContent = '';
    showCard(it, false);
    const sig = signal();
    current = sig;
    let r = 'done';
    if (it.type === 'scene' || it.type === 'transition') {
      setStatus('');
      r = await raceSig(sleep(1100), sig);
    } else if (it.type === 'direction') {
      setStatus('Stage direction');
      r = S.readDirections ? await (async () => { tape?.partner(true); const x = await raceSig(say(it.text, narrator()), sig); tape?.partner(false); return x; })() : await raceSig(sleep(Math.min(2800, 700 + it.text.length * 28)), sig);
    } else {
      setStatus(`${it.character} is speaking…`, 'speaking');
      const d = deliveryFor(script.items, script.items.indexOf(it));
      if (d.pause) r = await raceSig(sleep(d.pause), sig);
      if (r === 'done') {
        tape?.partner(true);
        r = await raceSig(speak(d.text, { ...voiceFor(it.character), rate: S.speechRate * d.rate, gain: d.gain, expressive: S.expressive }), sig);
        tape?.partner(false);
      }
      if (r === 'done') r = await raceSig(sleep(S.cueGap), sig);
    }
    cancelSpeech();
    current = null;
    if (r === 'done' || r === 'skip') return 'next';
    if (r === 'prompt') return 'restart';
    return r;
  }

  function myTurn(it) {
    return new Promise((resolve) => {
      const tokens = tokenize(it.text);
      const t = { carry: '', heard: '', prompts: 0, last: matchLine(it.text, '', level), startedAt: Date.now(), done: false };
      let idleTimer;
      let endTimer;
      let finished = false;
      let prompting = false;

      showCard(it, true);
      transcript.textContent = '';
      setStatus('Your line', 'listening');
      if ((isMobile && sttSupported) || useLocal) listener.resume();
      listener.resetTurn(isMobile || useLocal ? 0 : 1500);
      acceptInput = true;
      current = signal();
      current.p.then((a) => handleAction(a));

      const clear = () => {
        clearTimeout(idleTimer);
        clearTimeout(endTimer);
      };
      const end = (action) => {
        if (finished) return;
        finished = true;
        clear();
        acceptInput = false;
        onText = null;
        current = null;
        cancelSpeech();
        resolve(action);
      };
      const record = (status) => {
        results.push({
          lineId: it.id,
          status,
          score: Math.round(t.last.score * 100) / 100,
          prompts: t.prompts,
          missing: t.last.missing.slice(0, 12),
          said: t.heard.slice(0, 300),
          ms: Date.now() - t.startedAt,
        });
        bumpCounts();
      };
      const complete = async (status) => {
        if (finished || t.done) return;
        t.done = true;
        clear();
        acceptInput = false;
        record(status);
        turnUI.finish(status);
        card.classList.add(status);
        if (status === 'ok' && S.sound) chime(988, 80);
        setStatus(status === 'ok' ? 'Nailed it' : status === 'prompted' ? 'Got there with a prompt' : status === 'missed' ? 'Missed that one' : 'Skipped', status);
        await sleep(status === 'ok' ? 120 : 1300);
        end('next');
      };

      const armIdle = () => {
        clearTimeout(idleTimer);
        if (S.promptDelay > 0 && !finished) {
          const wait = S.promptDelay * 1000 * (t.prompts >= 2 ? 1.5 : 1);
          idleTimer = setTimeout(() => doPrompt(true), wait);
        }
      };

      const doPrompt = async (auto) => {
        if (finished || t.done || prompting) return;
        prompting = true;
        clearTimeout(idleTimer);
        clearTimeout(endTimer);
        t.prompts++;
        acceptInput = false;
        const m = matchLine(it.text, t.heard, level);
        t.last = m;
        if (t.prompts >= 3) {
          prompting = false;
          return complete('missed');
        }
        let spoken;
        if (t.prompts === 1) {
          spoken = hintFrom(it.text, m, 3);
          const start = Math.max(0, m.lastHit + 1);
          turnUI.reveal(start, 3);
          setStatus(auto ? 'Need a hand? Here\'s a nudge…' : 'Prompt…', 'prompting');
        } else {
          spoken = it.text.replace(/\([^)]*\)/g, '');
          turnUI.revealAll();
          setStatus('The full line…', 'prompting');
        }
        const sig = current;
        const r = await Promise.race([say(spoken, narrator()).then(() => 'done'), sig.p.then(() => 'sig')]);
        if (r === 'sig' || finished) {
          prompting = false;
          return;
        }
        await sleep(250);
        prompting = false;
        if (finished || t.done) return;
        t.carry = t.heard;
        listener.resetTurn();
        acceptInput = true;
        setStatus('Your line', 'listening');
        armIdle();
      };

      const handleAction = async (a) => {
        if (finished) return;
        if (a === 'prompt') {
          current = signal();
          current.p.then((x) => handleAction(x));
          return doPrompt(false);
        }
        if (a === 'done') return complete(t.prompts ? 'prompted' : 'ok');
        if (a === 'skip') return complete('skipped');
        if (a === 'pause' || a === 'back' || a === 'stop' || a === 'restart') return end(a);
      };

      onText = (text) => {
        if (finished) return;
        const cmd = detectCommand(text);
        const exp = tokenize(it.text).join(' ');
        const said = tokenize(text).join(' ');
        if (cmd && !exp.includes(said) && !t.done) {
          listener.resetTurn();
          transcript.textContent = '';
          if (cmd === 'prompt') return doPrompt(false);
          if (cmd === 'skip') return complete('skipped');
          if (cmd === 'repeat') return end('back');
          if (['back', 'restart', 'pause', 'stop'].includes(cmd)) return end(cmd);
          return;
        }
        const heard = `${t.carry} ${text}`.trim();
        const grew = heard !== t.heard;
        t.heard = heard;
        const m = matchLine(it.text, heard, level);
        t.last = m;
        turnUI.setMatched(m.matched);
        transcript.textContent = text;
        if (grew) armIdle();
        clearTimeout(endTimer);
        if (m.complete) {
          const lastWord = m.matched[tokens.length - 1] || m.lastHit >= tokens.length - 2;
          endTimer = setTimeout(() => complete(t.prompts ? 'prompted' : 'ok'), lastWord ? 60 : 800);
        }
      };

      armIdle();
    });
  }

  function pauseUntilResume() {
    cancelSpeech();
    acceptInput = false;
    resumeSig = signal();
    const ov = h('div', { class: 'overlay' },
      h('div', { class: 'dialog center' }, h('h2', {}, 'Paused'),
        h('div', { class: 'row gap center' },
          h('button', { class: 'btn gold', onclick: () => resumeSig.resolve('go') }, '▶ Resume'),
          h('button', { class: 'btn', onclick: () => resumeSig.resolve('top') }, '↺ Line again'),
          h('button', { class: 'btn danger', onclick: () => resumeSig.resolve('stop') }, 'End'))));
    document.body.append(ov);
    // say "resume" to continue
    onText = (text) => {
      if (detectCommand(text) === 'resume') resumeSig.resolve('go');
    };
    acceptInput = true;
    listener.resetTurn();
    return resumeSig.p.then((v) => {
      ov.remove();
      acceptInput = false;
      onText = null;
      return v;
    });
  }

  // Pre-render the next few partner lines so they start the instant the actor finishes.
  function prefetchAhead(from) {
    let n = 0;
    for (let k = from; k < queue.length && n < 3; k++) {
      const q = queue[k];
      if (q.type !== 'dialogue' || q.character === me) continue;
      const d = deliveryFor(script.items, script.items.indexOf(q));
      prefetchSpeech(d.text, { ...voiceFor(q.character), rate: S.speechRate * d.rate });
      n++;
    }
  }

  async function loop() {
    while (i < queue.length && !ended) {
      const it = queue[i];
      renderContext(i);
      progressFill.style.width = `${(i / queue.length) * 100}%`;
      const mine = it.type === 'dialogue' && it.character === me;
      setTimeout(() => !ended && prefetchAhead(i + (mine ? 0 : 1)), mine ? 0 : 300);
      const a = mine ? await myTurn(it) : await partnerTurn(it);
      if (ended) break;
      if (a === 'stop') {
        ended = true;
        break;
      }
      if (a === 'back') {
        i = Math.max(0, i - 1);
        // jump to the previous line that has something to say
        continue;
      }
      if (a === 'pause') {
        const v = await pauseUntilResume();
        if (v === 'stop') break;
        continue;
      }
      if (a === 'restart') continue;
      i++;
    }
    finish();
  }

  async function finish() {
    if (ended === 'done') return;
    ended = 'done';
    window.removeEventListener('keydown', onKey);
    listener.stop();
    cancelSpeech();
    cancelAnimationFrame(meterRaf);
    release();
    const blob = await mic.stop();
    const video = tape ? await tape.stop() : null; // { full, cut }
    const session = {
      id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      scriptId: script.id,
      character: me,
      startedAt,
      endedAt: Date.now(),
      mode: run.mode || 'full',
      strictness: level,
      results,
      hasRecording: !!(blob && S.record),
    };
    if (results.length) {
      await saveSession(session);
      if (session.hasRecording) await saveRecording(session.id, blob);
    }
    if (!destroyed) showSummary(session, blob, video);
  }

  function showSummary(session, blob, video) {
    const s = summarize(results);
    const rows = lastResultPerLine(results).map((r) => {
      const it = script.items.find((x) => x.id === r.lineId);
      const st = STATUS[r.status];
      return h('div', { class: `res-row ${st.cls}` },
        h('span', { class: 'res-ico' }, st.icon),
        h('div', { class: 'grow' }, h('div', {}, it?.text || ''),
          r.status !== 'ok' && r.missing?.length ? h('small', { class: 'muted' }, `Missed: ${r.missing.join(' ')}`) : null),
        h('span', { class: 'res-tag' }, st.label));
    });
    const audio = blob && session.hasRecording ? h('audio', { controls: true, src: URL.createObjectURL(blob) }) : null;
    const grade = s.total === 0 ? 'No lines this time.' : s.clean === 100 ? 'Word perfect. Take a bow! 🎭' : s.clean >= 80 ? 'Strong run.' : s.clean >= 50 ? 'Getting there. Run it again.' : 'Keep at it. The weak spots are listed below.';
    root.replaceChildren(h('section', { class: 'page summary' },
      h('h1', {}, 'Curtain call'),
      h('p', { class: 'lead' }, grade),
      h('div', { class: 'stat-grid' },
        stat(`${s.clean}%`, 'clean'), stat(s.ok, 'clean lines'), stat(s.prompted, 'prompted'), stat(s.missed, 'missed'),
        stat(formatDuration(session.endedAt - session.startedAt), 'duration')),
      video?.full && selfTapePanel(video, script.title, me),
      audio && h('div', { class: 'panel' }, h('h3', {}, 'Your recording'), audio),
      h('div', { class: 'row wrap gap' },
        h('button', { class: 'btn gold', onclick: () => { sessionStorage.setItem('cue-run', JSON.stringify({ ...run })); location.hash = `#/rehearse/${id}?r=${Date.now()}`; } }, '↺ Run it again'),
        s.prompted + s.missed + s.skipped > 0 && h('button', { class: 'btn', onclick: () => { sessionStorage.setItem('cue-run', JSON.stringify({ ...run, mode: 'trouble', startId: null })); location.hash = `#/rehearse/${id}?r=${Date.now()}`; } }, '🎯 Drill trouble lines'),
        h('button', { class: 'btn ghost', onclick: () => (location.hash = `#/script/${id}`) }, 'Back to script')),
      h('div', { class: 'panel' }, h('h3', {}, 'Line by line'), ...rows)));
  }
  const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));

  return () => {
    destroyed = true;
    cancelReady?.();
    ended = ended || true;
    window.removeEventListener('keydown', onKey);
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    if (!started) return;
    cancelSpeech();
    current?.resolve('stop');
    tape?.discard();
    resumeSig?.resolve('stop');
  };
}
