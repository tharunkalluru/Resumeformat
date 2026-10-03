import { readFile } from 'node:fs/promises';
import path from 'node:path';

import jsPDF from 'jspdf';

import { ParsedResume } from './parser';
import { RESUME_PROFILE } from './profile';

type PdfFontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

interface StyledRun {
  text: string;
  style: PdfFontStyle;
}

interface StyledToken {
  text: string;
  style: PdfFontStyle;
}

interface LayoutContext {
  pdf: jsPDF;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  left: number;
  right: number;
  y: number;
  dryRun: boolean;
  params: LayoutParams;
}

interface LayoutParams {
  fontSize: number;
  lineHeightRatio: number;
  sectionGapPx: number;
  jobGapPx: number;
  bulletGapPx: number;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 0.55 * 72;
const MARGIN_Y = 0.38 * 72;
const MAX_Y = PAGE_HEIGHT - MARGIN_Y;
const PX_TO_PT = 0.75;
const BASE_LAYOUT: LayoutParams = {
  fontSize: 9,
  lineHeightRatio: 1.45,
  sectionGapPx: 12,
  jobGapPx: 10,
  bulletGapPx: 3,
};
const MIN_LAYOUT = {
  fontSize: 7.65,
  lineHeightRatio: 1.25,
  sectionGapPx: 8,
  jobGapPx: 6,
  bulletGapPx: 1,
};
const MAX_LAYOUT = {
  fontSize: 10.35,
  lineHeightRatio: 1.6,
  sectionGapPx: 24,
  jobGapPx: 18,
  bulletGapPx: 6,
};
const TARGET_FILL_MIN = 0.96;
const FIT_TOLERANCE = 3.75;

let fontDataPromise: Promise<Record<string, string>> | null = null;

export class ResumeTooLongError extends Error {
  readonly code = 'RESUME_TOO_LONG';

  constructor(readonly overflowPoints: number) {
    super('The resume cannot fit on one page at the minimum readable font size.');
    this.name = 'ResumeTooLongError';
  }
}

function cleanPdfText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadFontData(): Promise<Record<string, string>> {
  if (!fontDataPromise) {
    const fontDir = path.join(process.cwd(), 'public', 'fonts');
    fontDataPromise = Promise.all([
      ['Carlito-Regular.ttf', readFile(path.join(fontDir, 'Carlito-Regular.ttf'))],
      ['Carlito-Bold.ttf', readFile(path.join(fontDir, 'Carlito-Bold.ttf'))],
      ['Carlito-Italic.ttf', readFile(path.join(fontDir, 'Carlito-Italic.ttf'))],
      ['Carlito-BoldItalic.ttf', readFile(path.join(fontDir, 'Carlito-BoldItalic.ttf'))],
    ]).then(async entries => {
      const resolved = await Promise.all(entries.map(async ([name, filePromise]) => {
        const contents = await filePromise;
        return [name, contents.toString('base64')] as const;
      }));
      return Object.fromEntries(resolved);
    });
  }
  return fontDataPromise;
}

async function registerFonts(pdf: jsPDF): Promise<string> {
  try {
    const fonts = await loadFontData();
    for (const [filename, data] of Object.entries(fonts)) {
      pdf.addFileToVFS(filename, data);
    }
    pdf.addFont('Carlito-Regular.ttf', 'Carlito', 'normal');
    pdf.addFont('Carlito-Bold.ttf', 'Carlito', 'bold');
    pdf.addFont('Carlito-Italic.ttf', 'Carlito', 'italic');
    pdf.addFont('Carlito-BoldItalic.ttf', 'Carlito', 'bolditalic');
    return 'Carlito';
  } catch (error) {
    console.warn('Unable to embed Carlito in server-generated PDF; using Helvetica.', error);
    return 'helvetica';
  }
}

function createPdf(): jsPDF {
  return new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
    compress: true,
    putOnlyUsedFonts: true,
  });
}

function setFont(ctx: LayoutContext, style: PdfFontStyle, size = ctx.fontSize) {
  ctx.pdf.setFont(ctx.fontFamily, style);
  ctx.pdf.setFontSize(size);
  ctx.pdf.setTextColor(0, 0, 0);
}

function isMetric(token: string): boolean {
  const cleaned = token.replace(/^[^$\d+~-]+|[^%KMBkmbxX+\d]+$/g, '');
  return /^(?:[+~]?)\$?\d[\d,.]*(?:%|[KMBkmbxX]\+?|\+)$/.test(cleaned);
}

function metricRuns(text: string, baseStyle: PdfFontStyle = 'normal'): StyledRun[] {
  return cleanPdfText(text)
    .split(/\s+/)
    .filter(Boolean)
    .map(word => ({ text: word, style: isMetric(word) ? 'bold' : baseStyle }));
}

function tokenizeRuns(runs: StyledRun[]): StyledToken[] {
  return runs.flatMap(run => cleanPdfText(run.text)
    .split(/\s+/)
    .filter(Boolean)
    .map(text => ({ text, style: run.style })));
}

function tokenWidth(ctx: LayoutContext, token: StyledToken, fontSize = ctx.fontSize): number {
  setFont(ctx, token.style, fontSize);
  return ctx.pdf.getTextWidth(token.text);
}

function splitLongToken(ctx: LayoutContext, token: StyledToken, maxWidth: number, fontSize: number): StyledToken[] {
  if (tokenWidth(ctx, token, fontSize) <= maxWidth) return [token];

  const pieces: StyledToken[] = [];
  let current = '';
  for (const character of token.text) {
    const candidate = `${current}${character}`;
    if (current && tokenWidth(ctx, { ...token, text: candidate }, fontSize) > maxWidth) {
      pieces.push({ ...token, text: current });
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push({ ...token, text: current });
  return pieces;
}

function wrapRuns(ctx: LayoutContext, runs: StyledRun[], maxWidth: number, fontSize: number): StyledToken[][] {
  const spaceWidth = (() => {
    setFont(ctx, 'normal', fontSize);
    return ctx.pdf.getTextWidth(' ');
  })();
  const tokens = tokenizeRuns(runs).flatMap(token => splitLongToken(ctx, token, maxWidth, fontSize));
  const lines: StyledToken[][] = [];
  let line: StyledToken[] = [];
  let lineWidth = 0;

  for (const token of tokens) {
    const width = tokenWidth(ctx, token, fontSize);
    const nextWidth = lineWidth + (line.length ? spaceWidth : 0) + width;
    if (line.length && nextWidth > maxWidth) {
      lines.push(line);
      line = [token];
      lineWidth = width;
    } else {
      line.push(token);
      lineWidth = nextWidth;
    }
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}

function drawRuns(
  ctx: LayoutContext,
  runs: StyledRun[],
  x: number,
  maxWidth: number,
  options: {
    lineHeight?: number;
    firstLineY?: number;
    justify?: boolean;
    fontSize?: number;
    wrapWidth?: number;
  } = {}
): number {
  const fontSize = options.fontSize ?? ctx.fontSize;
  const lines = wrapRuns(ctx, runs, options.wrapWidth ?? maxWidth, fontSize);
  const lineHeight = options.lineHeight ?? ctx.lineHeight;
  const firstLineY = options.firstLineY ?? ctx.y;

  if (!ctx.dryRun) {
    lines.forEach((line, lineIndex) => {
      const shouldJustify = options.justify && lineIndex < lines.length - 1 && line.length > 1;
      let cursorX = x;

      if (shouldJustify) {
        const wordWidth = line.reduce((total, token) => total + tokenWidth(ctx, token, fontSize), 0);
        const gap = (maxWidth - wordWidth) / (line.length - 1);
        setFont(ctx, 'normal', fontSize);
        const normalSpace = ctx.pdf.getTextWidth(' ');
        if (gap <= normalSpace * 3) {
          line.forEach((token, tokenIndex) => {
            setFont(ctx, token.style, fontSize);
            ctx.pdf.text(token.text, cursorX, firstLineY + lineIndex * lineHeight);
            cursorX += ctx.pdf.getTextWidth(token.text);
            if (tokenIndex < line.length - 1) cursorX += gap;
          });
          return;
        }
      }

      line.forEach((token, tokenIndex) => {
        setFont(ctx, token.style, fontSize);
        // Include the inter-word space in the PDF text object. Merely moving
        // the cursor creates the right visual gap but causes some ATS/PDF text
        // extractors to concatenate adjacent words.
        const renderedText = tokenIndex === 0 ? token.text : ` ${token.text}`;
        ctx.pdf.text(renderedText, cursorX, firstLineY + lineIndex * lineHeight);
        cursorX += ctx.pdf.getTextWidth(renderedText);
      });
    });
  }
  return lines.length;
}

function drawSectionTitle(ctx: LayoutContext, title: string) {
  // CSS vertical margins collapse between blocks. The first section follows a
  // 10px header margin; subsequent sections follow only --section-gap.
  ctx.y += Math.max(ctx.params.sectionGapPx * PX_TO_PT, 7.5);
  const titleSize = ctx.fontSize * 1.11;
  const titleTop = ctx.y;
  const baseline = titleTop + titleSize * 0.85;
  const titleLineHeight = titleSize * ctx.params.lineHeightRatio;
  setFont(ctx, 'bold', titleSize);
  if (!ctx.dryRun) {
    ctx.pdf.text(title.toUpperCase(), ctx.left, baseline);
    ctx.pdf.setLineWidth(1.125);
    ctx.pdf.line(ctx.left, baseline + 5, ctx.right, baseline + 5);
  }
  // line box + 1px padding + 1.5px border + 10px bottom margin
  ctx.y = titleTop + titleLineHeight + 0.75 + 1.125 + 7.5;
}

function drawHeader(ctx: LayoutContext) {
  const center = PAGE_WIDTH / 2;
  const nameSize = ctx.fontSize * 2.22;
  const nameTop = ctx.y;
  setFont(ctx, 'bold', nameSize);
  if (!ctx.dryRun) {
    ctx.pdf.text(RESUME_PROFILE.contact.name, center, nameTop + nameSize * 0.85, { align: 'center' });
  }

  const contactItems = [
    { text: RESUME_PROFILE.contact.linkedin, url: RESUME_PROFILE.contact.linkedinUrl },
    { text: RESUME_PROFILE.contact.portfolio, url: RESUME_PROFILE.contact.portfolioUrl },
    { text: RESUME_PROFILE.contact.email },
    { text: RESUME_PROFILE.contact.phone },
  ];
  setFont(ctx, 'normal', ctx.fontSize);
  const contactTop = nameTop + nameSize * ctx.params.lineHeightRatio + 4.5;
  if (!ctx.dryRun) {
    const bullet = '•';
    const bulletWidth = ctx.pdf.getTextWidth(bullet);
    const beforeBullet = ctx.pdf.getTextWidth('      ');
    const afterBullet = ctx.pdf.getTextWidth('  ');
    const totalWidth = contactItems.reduce(
      (width, item, index) => width + ctx.pdf.getTextWidth(item.text) +
        (index < contactItems.length - 1 ? beforeBullet + bulletWidth + afterBullet : 0),
      bulletWidth + afterBullet
    );
    let x = center - totalWidth / 2;
    const y = contactTop + ctx.fontSize * 0.85;
    ctx.pdf.text(bullet, x, y);
    x += bulletWidth + afterBullet;
    contactItems.forEach((item, index) => {
      const width = ctx.pdf.getTextWidth(item.text);
      ctx.pdf.text(item.text, x, y);
      if (item.url) ctx.pdf.link(x, y - ctx.fontSize, width, ctx.fontSize * 1.2, { url: item.url });
      x += width;
      if (index < contactItems.length - 1) {
        x += beforeBullet;
        ctx.pdf.text(bullet, x, y);
        x += bulletWidth + afterBullet;
      }
    });
  }
  ctx.y = contactTop + ctx.fontSize * 1.2;
}

function drawJob(ctx: LayoutContext, job: ParsedResume['experience'][number], index: number) {
  if (index > 0) ctx.y += ctx.params.jobGapPx * PX_TO_PT;

  const headerRuns: StyledRun[] = [{ text: cleanPdfText(job.title), style: 'bold' }];
  const secondary = [job.company, job.location].map(cleanPdfText).filter(Boolean).join(' | ');
  // The browser download renders the complete title line in bold.
  if (secondary) headerRuns.push({ text: `| ${secondary}`, style: 'bold' });

  const headerTop = ctx.y;
  const titleSize = ctx.fontSize * 1.056;
  setFont(ctx, 'italic');
  const date = cleanPdfText(job.dateRange);
  const dateWidth = date ? ctx.pdf.getTextWidth(date) : 0;
  const gap = date ? ctx.fontSize : 0;
  const headerWidth = ctx.right - ctx.left - dateWidth - gap;

  const headerLines = drawRuns(ctx, headerRuns, ctx.left, Math.max(headerWidth, 180), {
    firstLineY: headerTop + titleSize * 0.85,
    lineHeight: titleSize * ctx.params.lineHeightRatio,
    fontSize: titleSize,
  });
  if (!ctx.dryRun && date) {
    setFont(ctx, 'italic', ctx.fontSize);
    ctx.pdf.setTextColor(51, 51, 51);
    ctx.pdf.text(date, ctx.right, headerTop + ctx.fontSize * 0.85, { align: 'right' });
  }
  ctx.y = headerTop + headerLines * titleSize * ctx.params.lineHeightRatio + 2.25;

  for (const [bulletIndex, bullet] of job.bullets.entries()) {
    const bulletTop = ctx.y;
    const bulletX = ctx.left + 12;
    setFont(ctx, 'normal');
    const textX = bulletX + ctx.pdf.getTextWidth('•   ');
    if (!ctx.dryRun) {
      setFont(ctx, 'normal');
      ctx.pdf.text('•', bulletX, bulletTop + ctx.fontSize * 0.85);
    }
    const lineCount = drawRuns(
      ctx,
      metricRuns(bullet),
      textX,
      ctx.right - textX,
      {
        firstLineY: bulletTop + ctx.fontSize * 0.85,
        justify: true,
        // The browser lays out list text across the full <li> width; its PDF
        // renderer then reserves the bullet gutter while preserving those
        // exact DOM line breaks.
        wrapWidth: ctx.right - bulletX,
      }
    );
    ctx.y = bulletTop + lineCount * ctx.lineHeight;
    if (bulletIndex < job.bullets.length - 1) {
      ctx.y += ctx.params.bulletGapPx * PX_TO_PT;
    }
  }
}

function drawProject(ctx: LayoutContext, project: ParsedResume['startups'][number], index: number) {
  if (index > 0) ctx.y += 3.75;
  const top = ctx.y;
  const runs: StyledRun[] = [];
  if (project.role) runs.push({ text: cleanPdfText(project.role), style: 'bold' });
  if (project.description) {
    if (project.role) runs.push({ text: '-', style: 'normal' });
    runs.push(...metricRuns(project.description));
  }
  const lineCount = drawRuns(ctx, runs, ctx.left, ctx.right - ctx.left, {
    firstLineY: top + ctx.fontSize * 0.85,
    justify: true,
  });
  ctx.y = top + lineCount * ctx.lineHeight;
}

function drawSkill(ctx: LayoutContext, skill: ParsedResume['skills'][number], index: number) {
  if (index > 0) ctx.y += 3.75;
  const top = ctx.y;
  const lineCount = drawRuns(ctx, [
    { text: `${cleanPdfText(skill.label)}:`, style: 'bold' },
    { text: cleanPdfText(skill.skills), style: 'normal' },
  ], ctx.left, ctx.right - ctx.left, {
    firstLineY: top + ctx.fontSize * 0.85,
    justify: true,
  });
  ctx.y = top + lineCount * ctx.lineHeight;
}

function drawEducation(ctx: LayoutContext) {
  const education = RESUME_PROFILE.education;
  const school = `${education.school}, ${education.location}`;
  const top = ctx.y;
  const schoolSize = ctx.fontSize * 1.056;
  setFont(ctx, 'bold', schoolSize);
  if (!ctx.dryRun) ctx.pdf.text(school, ctx.left, top + schoolSize * 0.85);
  setFont(ctx, 'italic', ctx.fontSize);
  ctx.pdf.setTextColor(51, 51, 51);
  if (!ctx.dryRun) ctx.pdf.text(education.dateRange, ctx.right, top + ctx.fontSize * 0.85, { align: 'right' });

  const degreeTop = top + schoolSize * ctx.params.lineHeightRatio + 3;
  setFont(ctx, 'normal');
  if (!ctx.dryRun) ctx.pdf.text(education.degree, ctx.left, degreeTop + ctx.fontSize * 0.85);
  if (!ctx.dryRun) {
    ctx.pdf.text(`${education.gpaLabel}: ${education.gpa}`, ctx.right, degreeTop + ctx.fontSize * 0.85, { align: 'right' });
  }
  ctx.y = degreeTop + ctx.lineHeight;
  const courseworkTop = ctx.y;
  const courseworkLines = drawRuns(ctx, [{ text: `Selected Coursework: ${education.coursework}`, style: 'normal' }], ctx.left, ctx.right - ctx.left, {
    firstLineY: courseworkTop + ctx.fontSize * 0.85,
  });
  ctx.y = courseworkTop + courseworkLines * ctx.lineHeight;
}

function renderResume(pdf: jsPDF, resume: ParsedResume, fontFamily: string, params: LayoutParams, dryRun: boolean): number {
  const ctx: LayoutContext = {
    pdf,
    fontFamily,
    fontSize: params.fontSize,
    lineHeight: params.fontSize * params.lineHeightRatio,
    left: MARGIN_X,
    right: PAGE_WIDTH - MARGIN_X,
    y: MARGIN_Y,
    dryRun,
    params,
  };

  drawHeader(ctx);

  if (resume.experience.length) {
    drawSectionTitle(ctx, 'EXPERIENCE');
    resume.experience.forEach((job, index) => drawJob(ctx, job, index));
  }
  if (resume.startups.length) {
    drawSectionTitle(ctx, RESUME_PROFILE.projectSectionTitle);
    resume.startups.forEach((project, index) => drawProject(ctx, project, index));
  }
  if (resume.skills.length) {
    drawSectionTitle(ctx, 'SKILLS & COMPETENCIES');
    resume.skills.forEach((skill, index) => drawSkill(ctx, skill, index));
  }

  drawSectionTitle(ctx, 'EDUCATION');
  drawEducation(ctx);
  return ctx.y;
}

function selectLayout(pdf: jsPDF, resume: ParsedResume, fontFamily: string): { params: LayoutParams; finalY: number } {
  let params = { ...BASE_LAYOUT };
  let finalY = 0;
  const usableHeight = MAX_Y - MARGIN_Y;

  for (let iteration = 0; iteration < 40; iteration++) {
    finalY = renderResume(pdf, resume, fontFamily, params, true);
    const overflow = finalY - MAX_Y;
    const fillRatio = (finalY - MARGIN_Y) / usableHeight;

    if (overflow <= FIT_TOLERANCE && fillRatio >= TARGET_FILL_MIN) {
      return { params, finalY };
    }

    if (overflow > FIT_TOLERANCE) {
      const shrinkIntensity = Math.min(1, overflow / 75);
      if (params.lineHeightRatio > MIN_LAYOUT.lineHeightRatio) {
        params.lineHeightRatio = Math.max(
          MIN_LAYOUT.lineHeightRatio,
          params.lineHeightRatio - 0.05 * shrinkIntensity
        );
      }
      params.sectionGapPx = Math.max(MIN_LAYOUT.sectionGapPx, params.sectionGapPx - 2);
      params.jobGapPx = Math.max(MIN_LAYOUT.jobGapPx, params.jobGapPx - 1);
      params.bulletGapPx = Math.max(MIN_LAYOUT.bulletGapPx, params.bulletGapPx - 0.5);

      if (
        params.lineHeightRatio <= MIN_LAYOUT.lineHeightRatio + 0.05 &&
        params.sectionGapPx <= MIN_LAYOUT.sectionGapPx + 2
      ) {
        params.fontSize = Math.max(MIN_LAYOUT.fontSize, params.fontSize - 0.18);
      }
    } else {
      params.sectionGapPx = Math.min(MAX_LAYOUT.sectionGapPx, params.sectionGapPx + 3);
      params.jobGapPx = Math.min(MAX_LAYOUT.jobGapPx, params.jobGapPx + 2);
      params.bulletGapPx = Math.min(MAX_LAYOUT.bulletGapPx, params.bulletGapPx + 0.5);

      const remainingRatio = Math.max(0, (MAX_Y - finalY) / usableHeight);
      params.lineHeightRatio = Math.min(
        MAX_LAYOUT.lineHeightRatio,
        params.lineHeightRatio + 0.02 * remainingRatio
      );

      if (params.sectionGapPx >= MAX_LAYOUT.sectionGapPx - 2) {
        params.fontSize = Math.min(
          MAX_LAYOUT.fontSize,
          params.fontSize * (1 + remainingRatio * 0.05)
        );
      }
    }
  }

  finalY = renderResume(pdf, resume, fontFamily, params, true);
  return { params, finalY };
}

export async function generateResumePdf(resume: ParsedResume): Promise<Uint8Array> {
  const pdf = createPdf();
  const fontFamily = await registerFonts(pdf);

  const { params, finalY } = selectLayout(pdf, resume, fontFamily);
  if (finalY > MAX_Y + FIT_TOLERANCE) {
    throw new ResumeTooLongError(Math.ceil(finalY - MAX_Y));
  }

  renderResume(pdf, resume, fontFamily, params, false);
  return new Uint8Array(pdf.output('arraybuffer'));
}
