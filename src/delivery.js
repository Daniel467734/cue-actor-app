// Works out how a line should be delivered: tone, speed, volume and lead-in pause.
export const TONES = {
  '': { label: 'Auto', rate: 1, gain: 1, pause: 0 },
  angry: { label: 'Angry', rate: 1.12, gain: 1.25, pause: 0 },
  sad: { label: 'Sad', rate: 0.82, gain: 0.85, pause: 350 },
  excited: { label: 'Excited', rate: 1.18, gain: 1.15, pause: 0 },
  whisper: { label: 'Whisper', rate: 0.88, gain: 0.45, pause: 150 },
  tender: { label: 'Tender', rate: 0.86, gain: 0.8, pause: 200 },
  urgent: { label: 'Urgent', rate: 1.28, gain: 1.15, pause: 0 },
  afraid: { label: 'Afraid', rate: 1.15, gain: 0.75, pause: 0 },
  cold: { label: 'Cold', rate: 0.92, gain: 0.9, pause: 300 },
  slow: { label: 'Slow', rate: 0.75, gain: 1, pause: 300 },
};

const KEYWORDS = [
  ['whisper', /whisper|quiet|hush|under (his|her|their) breath|softly/],
  ['angry', /angr|furious|shout|yell|snap|bark|scream|rage|fume|hiss/],
  ['sad', /sad|cry|tear|sob|grie|mourn|broken|weep|despair/],
  ['excited', /excit|laugh|grin|delight|thrill|giddy|eager|beam/],
  ['tender', /tender|gentl|warm|loving|kind|sweet|smil/],
  ['urgent', /urgent|quick|rush|hurry|panic|frantic|desperate/],
  ['afraid', /afraid|scared|fear|nervous|trembl|shak|terrif|anxious/],
  ['cold', /cold|flat|deadpan|dry|stern|icy|curt|sarcas/],
  ['slow', /slow|pause|hesitat|beat|measured|thought/],
];

const toneFromText = (t) => KEYWORDS.find(([, re]) => re.test(t.toLowerCase()))?.[0] || '';

// Returns { text, rate, gain, pause } for the dialogue item at index i.
export function deliveryFor(items, i) {
  const it = items[i];
  let text = it.text;
  const inline = [...text.matchAll(/[([]([^)\]]{1,40})[)\]]/g)].map((m) => m[1]).join(' ');
  text = text.replace(/[([][^)\]]{1,40}[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const prev = items[i - 1];
  const dir = prev?.type === 'direction' && prev.parenthetical ? prev.text : '';
  let tone = it.tone || toneFromText(`${dir} ${inline}`);
  if (!tone) {
    const letters = text.replace(/[^A-Za-z]/g, '');
    const caps = letters.length > 8 && letters === letters.toUpperCase();
    if (caps || /!{2,}/.test(text)) tone = 'angry';
    else if ((text.match(/!/g) || []).length >= 2) tone = 'excited';
  }
  const d = TONES[tone] || TONES[''];
  return { text, rate: d.rate, gain: d.gain, pause: d.pause, tone };
}
