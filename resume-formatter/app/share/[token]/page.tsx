'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { FileText, Edit3, Download, ArrowLeft, Sparkles, Zap, Shield, Clock, AlertTriangle } from 'lucide-react';
import TextInput from '@/components/TextInput';
import EditableResumePreview from '@/components/EditableResumePreview';
import DownloadButton from '@/components/DownloadButton';
import { parseResumeText, ParsedResume } from '@/lib/parser';

type ViewMode = 'input' | 'preview';

// Token to email mapping - must match server config exactly
const TOKEN_EMAIL_MAP: Record<string, string> = {
  't99.k': 'tharun99.kalluru@gmail.com',
  'tk99': 'tharunkalluru99@gmail.com',
};

export default function SharePage() {
  const params = useParams();
  const token = params.token as string;

  const [viewMode, setViewMode] = useState<ViewMode>('input');
  const [parsedResume, setParsedResume] = useState<ParsedResume | null>(null);

  // Resolve email from token - this is the ONLY source of truth
  const resolvedEmail = useMemo(() => {
    if (!token || typeof token !== 'string') return null;
    return TOKEN_EMAIL_MAP[token] || null;
  }, [token]);

  const isValidLink = resolvedEmail !== null;

  // Store resolved email in a way that PDF generator can access
  useEffect(() => {
    if (resolvedEmail) {
      // Set on window for PDF generator to read (not editable by user)
      (window as any).__RESOLVED_EMAIL__ = resolvedEmail;
    }
    return () => {
      delete (window as any).__RESOLVED_EMAIL__;
    };
  }, [resolvedEmail]);

  const handleTextSubmit = useCallback((text: string) => {
    if (!isValidLink) return;
    const parsed = parseResumeText(text);
    setParsedResume(parsed);
    setViewMode('preview');
  }, [isValidLink]);

  const handleResumeChange = useCallback((updated: ParsedResume) => {
    setParsedResume(updated);
  }, []);

  const handleReset = useCallback(() => {
    setViewMode('input');
    setParsedResume(null);
  }, []);

  const pdfFilename = useMemo(() => {
    if (!parsedResume) return 'resume.pdf';
    const name = 'Tharun';
    const company = parsedResume.targetCompany;
    if (company) {
      return `${name} - ${company}.pdf`;
    }
    return `${name}.pdf`;
  }, [parsedResume]);

  // Invalid link error state
  if (!isValidLink) {
    return (
      <main className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center">
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-red-600/8 rounded-full blur-[128px]" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-red-600/8 rounded-full blur-[128px]" />
        </div>

        <div className="relative text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Invalid Share Link</h1>
          <p className="text-zinc-400 mb-6">
            This share link is invalid or has expired. Please request a valid link to access the resume formatter.
          </p>
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
            <p className="text-sm text-zinc-500">
              PDF export is disabled for invalid links.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#09090b] flex flex-col">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-600/8 rounded-full blur-[128px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-violet-600/8 rounded-full blur-[128px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/5 rounded-full blur-[128px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      {/* Header */}
      <header className="relative border-b border-white/5 backdrop-blur-2xl bg-black/40 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3 group cursor-pointer" onClick={() => viewMode === 'preview' && handleReset()}>
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-violet-600 rounded-xl blur-lg opacity-50 group-hover:opacity-75 transition-opacity" />
                <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg">
                  <FileText className="w-5 h-5 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-lg font-bold text-white tracking-tight">ResumeForge</h1>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Professional Formatter</p>
              </div>
            </div>

            {viewMode === 'preview' && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleReset}
                  className="group flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all duration-200"
                >
                  <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                  New Resume
                </button>
                <DownloadButton
                  filename={pdfFilename}
                  disabled={!parsedResume}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {viewMode === 'input' ? (
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-6">
                <Zap className="w-3.5 h-3.5" />
                Instant Professional Formatting
              </div>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4 tracking-tight">
                Transform Your Resume
                <br />
                <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
                  In Seconds
                </span>
              </h2>
              <p className="text-zinc-400 max-w-2xl mx-auto text-lg">
                Paste your GPT-generated text, edit directly on the formatted preview,
                and download a pixel-perfect PDF ready for applications.
              </p>
            </div>

            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-600/20 via-violet-600/20 to-purple-600/20 rounded-2xl blur-xl opacity-50 group-hover:opacity-75 transition-opacity duration-500" />
              <div className="relative bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 sm:p-8 shadow-2xl">
                <TextInput onSubmit={handleTextSubmit} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-10">
              <div className="group relative p-5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] transition-all duration-300">
                <div className="w-10 h-10 mb-4 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-blue-400" />
                </div>
                <h3 className="font-semibold text-white mb-1">Smart Detection</h3>
                <p className="text-sm text-zinc-500">Auto-detects sections, roles, dates, and metrics</p>
              </div>
              <div className="group relative p-5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] transition-all duration-300">
                <div className="w-10 h-10 mb-4 rounded-lg bg-violet-500/10 flex items-center justify-center">
                  <Edit3 className="w-5 h-5 text-violet-400" />
                </div>
                <h3 className="font-semibold text-white mb-1">Live Editing</h3>
                <p className="text-sm text-zinc-500">Click any text to edit directly on preview</p>
              </div>
              <div className="group relative p-5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] transition-all duration-300">
                <div className="w-10 h-10 mb-4 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Download className="w-5 h-5 text-emerald-400" />
                </div>
                <h3 className="font-semibold text-white mb-1">Perfect PDF</h3>
                <p className="text-sm text-zinc-500">Download ATS-friendly, high-quality PDFs</p>
              </div>
            </div>

            <div className="flex items-center justify-center gap-6 mt-10 text-zinc-600 text-sm">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                <span>100% Private</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-zinc-700" />
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>No Sign-up Required</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-zinc-700" />
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                <span>Instant Results</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
            <div className="mb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                  <Edit3 className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Live Editor</p>
                  <p className="text-xs text-zinc-500">Click any text to edit directly</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-500">
                <div className="flex items-center gap-1.5">
                  <kbd className="px-2 py-1 bg-zinc-800 rounded border border-zinc-700 font-mono">Enter</kbd>
                  <span>save</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <kbd className="px-2 py-1 bg-zinc-800 rounded border border-zinc-700 font-mono">Shift + Enter</kbd>
                  <span>new line</span>
                </div>
              </div>
            </div>

            {parsedResume && (
              <div className="relative group">
                <div className="absolute -inset-2 bg-gradient-to-b from-white/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative overflow-auto bg-zinc-900/50 backdrop-blur border border-white/10 rounded-2xl p-4 sm:p-8 shadow-2xl" style={{ maxHeight: 'calc(100vh - 220px)' }}>
                  <div className="shadow-2xl shadow-black/50 mx-auto" style={{ width: 'fit-content' }}>
                    <EditableResumePreview
                      parsedResume={parsedResume}
                      onResumeChange={handleResumeChange}
                      overrideEmail={resolvedEmail}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-center sm:hidden">
              <DownloadButton
                filename={pdfFilename}
                disabled={!parsedResume}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="relative border-t border-white/5 mt-auto bg-black/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-zinc-600">
              <FileText className="w-4 h-4" />
              <span className="text-sm font-medium">ResumeForge</span>
            </div>
            <p className="text-xs text-zinc-600">
              Transform plain text into professional resumes instantly
            </p>
            <div className="flex items-center gap-4 text-xs text-zinc-600">
              <span>Made with precision</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
