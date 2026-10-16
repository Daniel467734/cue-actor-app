// Script exports: Fountain, plain text (stage / screenplay layout), PDF, and backup JSON helpers.

const wrap = (text, width) => {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = `${cur} ${w}`.trim();
  }
  if (cur) lines.push(cur);
  return lines;
};

export function toFountain(script) {
  const out = [`Title: ${script.title}`, `Draft date: ${new Date().toLocaleDateString()}`, ''];
  const cue = (c) => (/[a-z]/.test(c) ? `@${c}` : c);
  let cueWritten = false;
  const items = script.items;
  for (let i = 0; i < items.length; i++) {
    const l = items[i];
    if (l.type === 'scene') out.push(/^(INT|EXT|EST|I\/E)/i.test(l.text) ? l.text.toUpperCase() : `.${l.text.toUpperCase()}`, '');
    else if (l.type === 'transition') out.push(`> ${l.text.toUpperCase()}`, '');
    else if (l.type === 'direction' && l.parenthetical && items[i + 1]?.type === 'dialogue') {
      out.push(cue(items[i + 1].character), `(${l.text})`);
      cueWritten = true;
    } else if (l.type === 'direction') out.push(l.parenthetical ? `[[${l.text}]]` : l.text, '');
    else {
      if (!cueWritten) out.push(cue(l.character));
      out.push(l.text, '');
      cueWritten = false;
    }
  }
  return out.join('\n');
}

export function toStageText(script) {
  const out = [script.title.toUpperCase(), ''];
  for (const l of script.items) {
    if (l.type === 'scene' || l.type === 'transition') out.push('', l.text.toUpperCase(), '');
    else if (l.type === 'direction') out.push(`(${l.text})`);
    else out.push(`${l.character}: ${l.text}`);
  }
  return out.join('\n');
}

export function toScreenplayText(script) {
  const out = [script.title.toUpperCase().padStart(40 + script.title.length / 2), '', ''];
  for (const l of script.items) {
    if (l.type === 'scene') out.push('', l.text.toUpperCase(), '');
    else if (l.type === 'transition') out.push('', l.text.toUpperCase().padStart(60), '');
    else if (l.type === 'direction') {
      if (l.parenthetical) out.push(`${' '.repeat(16)}(${l.text})`);
      else out.push(...wrap(l.text, 60), '');
    } else {
      out.push(`${' '.repeat(22)}${l.character}`);
      wrap(l.text, 35).forEach((w) => out.push(' '.repeat(10) + w));
      out.push('');
    }
  }
  return out.join('\n');
}

export const toText = (script, style = script.format) => (style === 'screenplay' ? toScreenplayText(script) : toStageText(script));

export async function toPDF(script, style = script.format) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  doc.setFont('courier', 'normal');
  doc.setFontSize(12);
  const lh = 14;
  const top = 72;
  const bottom = 720;
  let y = top;
  let page = 1;
  const num = () => {
    doc.setFontSize(10);
    doc.text(`${page}.`, 540, 48, { align: 'right' });
    doc.setFontSize(12);
  };
  const ensure = (n = 1) => {
    if (y + lh * n > bottom) {
      doc.addPage();
      page++;
      y = top;
      num();
    }
  };
  const write = (text, x, width, bold = false) => {
    doc.setFont('courier', bold ? 'bold' : 'normal');
    for (const line of doc.splitTextToSize(text, width)) {
      ensure();
      doc.text(line, x, y);
      y += lh;
    }
  };
  doc.setFont('courier', 'bold');
  doc.setFontSize(18);
  doc.text(script.title, 306, 280, { align: 'center' });
  doc.setFontSize(12);
  doc.setFont('courier', 'normal');
  doc.text(new Date().toLocaleDateString(), 306, 310, { align: 'center' });
  doc.addPage();
  page = 2;
  num();
  for (const l of script.items) {
    if (l.type === 'scene') {
      y += lh;
      ensure(3);
      write(l.text.toUpperCase(), 108, 430, true);
      y += lh / 2;
    } else if (l.type === 'transition') {
      ensure(2);
      write(l.text.toUpperCase(), 108, 430);
    } else if (l.type === 'direction') {
      if (l.parenthetical) write(`(${l.text})`, style === 'screenplay' ? 250 : 144, 200);
      else {
        write(l.text, 108, 430);
        y += lh / 2;
      }
    } else if (style === 'screenplay') {
      ensure(4);
      write(l.character, 250, 250);
      write(l.text, 180, 252);
      y += lh / 2;
    } else {
      ensure(2);
      doc.setFont('courier', 'bold');
      const label = `${l.character}: `;
      const labelW = doc.getTextWidth(label);
      doc.text(label, 108, y);
      doc.setFont('courier', 'normal');
      const lines = doc.splitTextToSize(l.text, 430 - labelW);
      lines.forEach((line, i) => {
        if (i > 0) ensure();
        doc.text(line, 108 + labelW, y);
        y += lh;
      });
      y += lh / 3;
    }
  }
  return doc.output('blob');
}
