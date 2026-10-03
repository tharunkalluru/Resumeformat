import jsPDF from 'jspdf';
import { DocumentNode, validateDocument } from './document';

export type PdfFonts = Record<string, string>;
type Style = 'normal' | 'bold' | 'italic' | 'bolditalic';
type Token = { text: string; style: Style; underline: boolean };

const WIDTH = 612;
const HEIGHT = 792;
const LEFT = 39.6;
const RIGHT = WIDTH - LEFT;
const TOP = 32;
const BOTTOM = HEIGHT - TOP;
const FONT_FILES: Record<Style, string> = {
  normal: 'Carlito-Regular.ttf', bold: 'Carlito-Bold.ttf',
  italic: 'Carlito-Italic.ttf', bolditalic: 'Carlito-BoldItalic.ttf',
};

function styleFor(node: DocumentNode): { style: Style; underline: boolean } {
  const bold = node.marks?.some(mark => mark.type === 'bold');
  const italic = node.marks?.some(mark => mark.type === 'italic');
  return { style: bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal',
    underline: !!node.marks?.some(mark => mark.type === 'underline') };
}

function tokensFor(nodes: DocumentNode[]): Token[] {
  return nodes.flatMap(node => {
    if (node.type === 'hardBreak') return [{ text: '\n', style: 'normal' as Style, underline: false }];
    const { style, underline } = styleFor(node);
    return (node.text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\r\n?/g, '\n')
      .split(/(\n|\s+)/).filter(Boolean)
      .map(text => ({ text, style, underline }));
  });
}

/** Render the same validated document used by the canvas and PDF API. */
export function generateDocumentPdf(input: unknown, fonts?: PdfFonts): Uint8Array {
  const document = validateDocument(input);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true, putOnlyUsedFonts: true });
  let family = 'helvetica';
  if (fonts && Object.values(FONT_FILES).every(file => !!fonts[file])) {
    for (const file of Object.values(FONT_FILES)) pdf.addFileToVFS(file, fonts[file]);
    for (const [style, file] of Object.entries(FONT_FILES)) pdf.addFont(file, 'Carlito', style);
    family = 'Carlito';
  }

  let y = TOP;
  const setFont = (style: Style, size: number) => {
    pdf.setFont(family, style);
    pdf.setFontSize(size);
    pdf.setTextColor(20, 24, 32);
  };
  const measure = (text: string, style: Style, size: number) => {
    setFont(style, size);
    return pdf.getTextWidth(text);
  };
  const ensureRoom = (height: number) => {
    if (y + height > BOTTOM) { pdf.addPage(); y = TOP; }
  };

  const renderLine = (line: Token[], size: number, lineHeight: number, indent: number, prefix?: string, center = false) => {
    ensureRoom(lineHeight);
    const baseline = y + size * 0.82;
    let x = center
      ? LEFT + (RIGHT - LEFT - line.reduce((total, token) => total + measure(token.text, token.style, size), 0)) / 2
      : LEFT + indent;
    if (prefix) {
      setFont('normal', size);
      pdf.text(prefix, LEFT + Math.max(indent - 13, 0), baseline);
    }
    for (const token of line) {
      setFont(token.style, size);
      pdf.text(token.text, x, baseline);
      const width = pdf.getTextWidth(token.text);
      if (token.underline && token.text.trim()) {
        pdf.setLineWidth(0.5);
        pdf.line(x, baseline + 1.3, x + width, baseline + 1.3);
      }
      x += width;
    }
    y += lineHeight;
  };

  const renderText = (nodes: DocumentNode[], size: number, lineHeight: number, indent = 0, prefix?: string, center = false) => {
    const maxWidth = RIGHT - LEFT - indent;
    let line: Token[] = [];
    let width = 0;
    let first = true;
    const flush = () => {
      renderLine(line, size, lineHeight, indent, first ? prefix : undefined, center);
      line = [];
      width = 0;
      first = false;
    };
    for (const token of tokensFor(nodes)) {
      if (token.text === '\n') { flush(); continue; }
      if (/^\s+$/.test(token.text) && !line.length) continue;
      let parts = [token];
      if (!/^\s+$/.test(token.text) && measure(token.text, token.style, size) > maxWidth) {
        parts = [];
        let part = '';
        for (const char of token.text) {
          if (part && measure(part + char, token.style, size) > maxWidth) {
            parts.push({ ...token, text: part });
            part = char;
          } else part += char;
        }
        if (part) parts.push({ ...token, text: part });
      }
      for (const piece of parts) {
        const pieceWidth = measure(piece.text, piece.style, size);
        if (line.length && width + pieceWidth > maxWidth) flush();
        if (/^\s+$/.test(piece.text) && !line.length) continue;
        line.push(piece);
        width += pieceWidth;
      }
    }
    if (line.length || first) flush();
  };

  const renderBlock = (block: DocumentNode, depth = 0, center = false) => {
    if (block.type === 'heading') {
      const level = block.attrs?.level || 2;
      const size = level === 1 ? 19 : level === 2 ? 11 : 10;
      y += level === 1 ? 0 : level === 2 ? 12 : 7;
      ensureRoom(size * 2.5);
      renderText(block.content || [], size, size * 1.3, 0, undefined, level === 1);
      if (level === 2) {
        pdf.setLineWidth(0.8);
        pdf.line(LEFT, y + 1.5, RIGHT, y + 1.5);
        y += 5;
      }
    } else if (block.type === 'paragraph') {
      y += 3;
      renderText(block.content || [], 10, 13, 0, undefined, center);
    } else if (block.type === 'bulletList' || block.type === 'orderedList') {
      y += 2;
      for (const [index, item] of (block.content || []).entries()) {
        const prefix = block.type === 'bulletList' ? '•' : `${(block.attrs?.start || 1) + index}.`;
        const paragraphs = item.content || [];
        for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
          if (paragraph.type === 'paragraph') {
            renderText(paragraph.content || [], 10, 13, 18 + depth * 14, paragraphIndex === 0 ? prefix : undefined);
          } else renderBlock(paragraph, depth + 1);
        }
        y += 2;
      }
    }
  };
  for (const [index, block] of (document.content || []).entries()) {
    renderBlock(block, 0, index === 1 && document.content?.[0]?.type === 'heading' && document.content[0].attrs?.level === 1);
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}
