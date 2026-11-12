import JSZip from 'jszip';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

/** Plain reading-order text of a resume file. Used when only the words are needed, not the layout. */
export async function plainText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  return (isPdf ? await pdfText(bytes) : await docxText(bytes)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const document = await pdfjs.getDocument({ data: bytes, useSystemFonts: false }).promise;
  try {
    const pages: string[] = [];
    for (let number = 1; number <= Math.min(document.numPages, 6); number++) {
      const content = await (await document.getPage(number)).getTextContent();
      // Group text runs into lines by baseline, then read each line left to right.
      const lines = new Map<number, { x: number; text: string; width: number }[]>();
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        const y = Math.round(item.transform[5] / 3) * 3, line = lines.get(y) ?? [];
        line.push({ x: item.transform[4], text: item.str, width: item.width }); lines.set(y, line);
      }
      pages.push([...lines].sort((a, b) => b[0] - a[0]).map(([, runs]) => {
        let text = '', end = 0;
        for (const run of runs.sort((a, b) => a.x - b.x)) { text += (text && run.x - end > 1.5 && !text.endsWith(' ') && !run.text.startsWith(' ') ? ' ' : '') + run.text; end = run.x + run.width; }
        return text.trim();
      }).filter(Boolean).join('\n'));
    }
    return pages.join('\n\n');
  } finally { await document.loadingTask.destroy(); }
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This file is not a readable Word document.');
  const decode = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(paragraph =>
    decode((paragraph.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? []).map(part => part.startsWith('<w:t') && !part.startsWith('<w:tab') ? part.replace(/<[^>]+>/g, '') : ' ').join('')).trim()).filter(Boolean).join('\n');
}
