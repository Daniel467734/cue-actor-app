// Turns raw script text (stage play, screenplay, Fountain, FDX) into structured lines.

let counter = 0;
export const uid = () => `l${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const SCENE_RE = /^(?:INT|EXT|EST|INT\.?\s*\/\s*EXT|I\s*\/\s*E)[.\s]/i;
const STAGE_SCENE_RE = /^(?:ACT|SCENE|PROLOGUE|EPILOGUE|PART|PAGE)\s+[IVXLC\d]+\b.*$/i;
const TRANSITION_RE = /^(?:[A-Z ]+ TO:|FADE (?:IN|OUT)[.:]?|CUT TO BLACK\.?|THE END\.?)$/;
const STAGE_RE = /^\s*([A-Za-z][A-Za-z0-9 .'’\-/&]{0,30}?)\s*:\s*(.*)$/;
const NOISE_RE = /^\s*(?:\d{1,3}\.?|\(?(?:CONTINUED|MORE)\)?:?|CONTINUED:?|page \d+( of \d+)?)\s*$/i;

export function cleanName(raw) {
  return raw
    .replace(/\((?:V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?D\.?|CONT’D\.?|CONTINUING|FILTERED|ON PHONE)\)/gi, '')
    .replace(/\s*\^$/, '')
    .replace(/^@/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const isUpper = (s) => /[A-Z]/.test(s) && s === s.toUpperCase();
const isBlank = (s) => !s || !s.trim();

function looksLikeCue(line, next) {
  const t = line.trim();
  if (!t || t.length > 40) return false;
  if (t.startsWith('@')) return !isBlank(next);
  if (SCENE_RE.test(t) || TRANSITION_RE.test(t) || NOISE_RE.test(t)) return false;
  const base = t.replace(/\([^)]*\)/g, '').trim();
  if (!base || !isUpper(base) || /[.!?,;:]$/.test(base) || base.split(/\s+/).length > 4) return false;
  return !isBlank(next);
}

function detectFormat(lines) {
  let stage = 0;
  let screen = 0;
  const stageNames = new Set();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = STAGE_RE.exec(l);
    if (m && m[2] && m[1].split(/\s+/).length <= 4 && !SCENE_RE.test(l) && !/^(?:note|title|author|draft|date|contact|credit|source|copyright)$/i.test(m[1].trim())) {
      stage++;
      stageNames.add(m[1].trim().toUpperCase());
    }
    if ((i === 0 || isBlank(lines[i - 1])) && looksLikeCue(l, lines[i + 1])) screen++;
  }
  if (stage >= 3 && stageNames.size >= 2 && stage >= screen) return 'stage';
  return 'screenplay';
}

function pushDirection(out, text, type = 'direction', extra = {}) {
  const t = text.trim();
  if (t) out.push({ id: uid(), type, text: t, ...extra });
}

function parseStage(lines) {
  const out = [];
  let last = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || NOISE_RE.test(line)) {
      last = null;
      continue;
    }
    const m = STAGE_RE.exec(raw);
    if (m && m[2] !== undefined && m[1].split(/\s+/).length <= 4 && !SCENE_RE.test(line)) {
      let text = m[2].trim();
      const dirs = [];
      text = text.replace(/\(([^)]*)\)/g, (_, d) => {
        if (d.trim()) dirs.push(d.trim());
        return ' ';
      }).replace(/\s+/g, ' ').trim();
      dirs.forEach((d) => pushDirection(out, d, 'direction', { parenthetical: true }));
      last = { id: uid(), type: 'dialogue', character: cleanName(m[1]), text };
      out.push(last);
      continue;
    }
    if (STAGE_SCENE_RE.test(line) || (isUpper(line) && line.length < 60 && !/[:]/.test(line))) {
      out.push({ id: uid(), type: 'scene', text: line });
      last = null;
      continue;
    }
    if (/^[([].*[)\]]$/.test(line)) {
      pushDirection(out, line.replace(/^[([]|[)\]]$/g, ''), 'direction');
      continue;
    }
    if (last) {
      last.text = `${last.text} ${line}`.trim();
    } else {
      pushDirection(out, line);
    }
  }
  return out.filter((l) => l.type !== 'dialogue' || l.text);
}

function parseScreenplay(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || NOISE_RE.test(line)) {
      i++;
      continue;
    }
    if (/^(?:title|credit|author|authors|source|draft date|contact|copyright)\s*:/i.test(line) && i < 12) {
      i++;
      continue;
    }
    if (line.startsWith('>') && !line.endsWith('<')) {
      out.push({ id: uid(), type: 'transition', text: line.slice(1).trim().toUpperCase() });
      i++;
      continue;
    }
    if (SCENE_RE.test(line) || (line.startsWith('.') && /^\.[A-Za-z]/.test(line))) {
      out.push({ id: uid(), type: 'scene', text: line.replace(/^\./, '').replace(/\s*#[^#]+#\s*$/, '').trim().toUpperCase() });
      i++;
      continue;
    }
    if (TRANSITION_RE.test(line)) {
      out.push({ id: uid(), type: 'transition', text: line });
      i++;
      continue;
    }
    const prevBlank = i === 0 || isBlank(lines[i - 1]);
    if ((prevBlank || line.startsWith('@')) && looksLikeCue(line, lines[i + 1]) && !line.startsWith('!')) {
      const character = cleanName(line);
      let j = i + 1;
      const parts = [];
      while (j < lines.length && !isBlank(lines[j])) {
        const t = lines[j].trim();
        if (NOISE_RE.test(t)) {
          j++;
          continue;
        }
        if (/^\(.*\)$/.test(t)) {
          if (parts.length) {
            out.push({ id: uid(), type: 'dialogue', character, text: parts.join(' ') });
            parts.length = 0;
          }
          pushDirection(out, t.slice(1, -1), 'direction', { parenthetical: true });
        } else {
          const inline = t.replace(/\(([^)]*)\)/g, (_, d) => {
            if (d.trim()) pushDirection(out, d, 'direction', { parenthetical: true });
            return ' ';
          }).replace(/\s+/g, ' ').trim();
          if (inline) parts.push(inline);
        }
        j++;
      }
      if (parts.length) out.push({ id: uid(), type: 'dialogue', character, text: parts.join(' ') });
      i = j;
      continue;
    }
    // action: gather until blank
    const act = [line.replace(/^!/, '')];
    let j = i + 1;
    while (j < lines.length && !isBlank(lines[j]) && !SCENE_RE.test(lines[j].trim())) {
      if (looksLikeCue(lines[j], lines[j + 1]) && isBlank(lines[j - 1])) break;
      act.push(lines[j].trim());
      j++;
    }
    pushDirection(out, act.join(' '));
    i = j;
  }
  return out;
}

export function parseFDX(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out = [];
  let character = '';
  for (const p of doc.querySelectorAll('Content > Paragraph')) {
    const type = p.getAttribute('Type');
    const text = [...p.querySelectorAll('Text')].map((t) => t.textContent).join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (type === 'Scene Heading') out.push({ id: uid(), type: 'scene', text: text.toUpperCase() });
    else if (type === 'Character') character = cleanName(text);
    else if (type === 'Dialogue') out.push({ id: uid(), type: 'dialogue', character, text });
    else if (type === 'Parenthetical') pushDirection(out, text.replace(/^\(|\)$/g, ''), 'direction', { parenthetical: true });
    else if (type === 'Transition') out.push({ id: uid(), type: 'transition', text: text.toUpperCase() });
    else pushDirection(out, text);
  }
  return out;
}

export function parseScriptText(text, format = 'auto') {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const fmt = format === 'auto' ? detectFormat(lines) : format;
  const items = fmt === 'stage' ? parseStage(lines) : parseScreenplay(lines);
  return { items, format: fmt };
}

export function listCharacters(items) {
  const map = new Map();
  for (const l of items) {
    if (l.type !== 'dialogue' || !l.character) continue;
    const c = map.get(l.character) || { name: l.character, lines: 0, words: 0 };
    c.lines++;
    c.words += l.text.split(/\s+/).filter(Boolean).length;
    map.set(l.character, c);
  }
  return [...map.values()].sort((a, b) => b.lines - a.lines);
}

export function newScript({ title = 'Untitled script', items = [], format = 'stage' } = {}) {
  return {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title,
    format,
    items,
    voices: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
