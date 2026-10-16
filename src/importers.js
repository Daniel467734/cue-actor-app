// File import: PDF, DOCX, TXT/Fountain, FDX, pasted text.
import { parseScriptText, parseFDX, newScript } from './parser.js';

async function pdfToText(buffer) {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const rows = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (row) row.items.push(it);
      else rows.push({ y, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    const gaps = rows.slice(1).map((r, i) => rows[i].y - r.y).filter((g) => g > 0).sort((a, b) => a - b);
    const normal = gaps[Math.floor(gaps.length / 2)] || 12;
    rows.forEach((r, i) => {
      r.items.sort((a, b) => a.transform[4] - b.transform[4]);
      if (i > 0 && rows[i - 1].y - r.y > normal * 1.45) out.push('');
      out.push(r.items.map((x) => x.str).join(' ').replace(/\s{2,}/g, ' ').trim());
    });
    out.push('');
  }
  return out.join('\n');
}

async function docxToText(buffer) {
  const mammoth = (await import('mammoth/mammoth.browser.min.js')).default;
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
  return value;
}

export async function importFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let items;
  let format = 'stage';
  if (ext === 'fdx') {
    items = parseFDX(await file.text());
    format = 'screenplay';
  } else {
    let text;
    if (ext === 'pdf') text = await pdfToText(await file.arrayBuffer());
    else if (ext === 'docx') text = await docxToText(await file.arrayBuffer());
    else text = await file.text();
    ({ items, format } = parseScriptText(text));
  }
  if (!items.some((i) => i.type === 'dialogue')) {
    throw new Error("Couldn't find any dialogue in that file. Try pasting the text instead, or check the format.");
  }
  return newScript({ title: name, items, format });
}

export function importText(text, title = 'Pasted script') {
  const { items, format } = parseScriptText(text);
  if (!items.some((i) => i.type === 'dialogue')) {
    throw new Error("Couldn't find any dialogue. Use lines like \"HAMLET: To be or not to be\" or screenplay format.");
  }
  return newScript({ title, items, format });
}
