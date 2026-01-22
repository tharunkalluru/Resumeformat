'use client';

import { useState } from 'react';
import { Download, FileText, Loader2, Check } from 'lucide-react';
import { generatePDF } from '@/lib/pdfGenerator';

interface DownloadButtonProps {
  filename?: string;
  disabled?: boolean;
}

export default function DownloadButton({ filename = 'resume.pdf', disabled }: DownloadButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleDownload = async () => {
    if (disabled || isGenerating) return;

    setIsGenerating(true);
    setIsSuccess(false);

    try {
      await generatePDF('resume-preview', filename);
      setIsSuccess(true);
      setTimeout(() => setIsSuccess(false), 2000);
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
      disabled={disabled || isGenerating}
      className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
        isSuccess
          ? 'bg-green-600 text-white'
          : disabled || isGenerating
          ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
          : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40'
      }`}
    >
      {isGenerating ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Generating...</span>
        </>
      ) : isSuccess ? (
        <>
          <Check className="w-5 h-5" />
          <span>Downloaded!</span>
        </>
      ) : (
        <>
          <Download className="w-5 h-5" />
          <span>Download PDF</span>
        </>
      )}
    </button>
  );
}
