'use client';

import { useState } from 'react';
import { Loader2, Check, FileDown } from 'lucide-react';
import { DocumentNode } from '@/lib/document';
import { generateDocumentPdf, PdfFonts } from '@/lib/documentPdf';

interface DownloadButtonProps {
  filename?: string;
  disabled?: boolean;
  document?: DocumentNode | null;
}

let fontsPromise: Promise<PdfFonts> | undefined;
function loadFonts(): Promise<PdfFonts> {
  if (!fontsPromise) {
    fontsPromise = Promise.all(['Carlito-Regular.ttf', 'Carlito-Bold.ttf', 'Carlito-Italic.ttf', 'Carlito-BoldItalic.ttf'].map(async name => {
      const response = await fetch(`/fonts/${name}`);
      if (!response.ok) throw new Error(`Unable to load ${name}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return [name, btoa(binary)] as const;
    })).then(Object.fromEntries).catch(error => { fontsPromise = undefined; throw error; });
  }
  return fontsPromise;
}

export default function DownloadButton({ filename = 'resume.pdf', disabled, document }: DownloadButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleDownload = async () => {
    if (disabled || isGenerating || !document) return;

    setIsGenerating(true);
    setIsSuccess(false);

    try {
      const bytes = generateDocumentPdf(document, await loadFonts());
      const safeFilename = (filename.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-').trim().slice(0, 120) || 'resume.pdf').replace(/\.pdf$/i, '') + '.pdf';
      const blob = new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = safeFilename;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setIsSuccess(true);
      setTimeout(() => setIsSuccess(false), 2500);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={disabled || !document || isGenerating}
      className={`group relative flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 ${
        isSuccess
          ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
          : disabled || isGenerating
          ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
          : 'bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-500/25 hover:shadow-violet-500/30 hover:scale-[1.02] active:scale-[0.98]'
      }`}
    >
      {/* Glow effect */}
      {!disabled && !isGenerating && !isSuccess && (
        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 blur-lg opacity-40 group-hover:opacity-60 transition-opacity -z-10" />
      )}
      
      {isGenerating ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Generating...</span>
        </>
      ) : isSuccess ? (
        <>
          <Check className="w-4 h-4" />
          <span>Downloaded!</span>
        </>
      ) : (
        <>
          <FileDown className="w-4 h-4 group-hover:animate-bounce" style={{ animationDuration: '0.6s' }} />
          <span>Download PDF</span>
        </>
      )}
    </button>
  );
}
