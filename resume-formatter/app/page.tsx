'use client';

import { useState, useCallback } from 'react';
import { FileText, Edit3, Download, ArrowLeft, Sparkles } from 'lucide-react';
import TextInput from '@/components/TextInput';
import EditableResumePreview from '@/components/EditableResumePreview';
import DownloadButton from '@/components/DownloadButton';
import { parseResumeText, ParsedResume } from '@/lib/parser';

type ViewMode = 'input' | 'preview';

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>('input');
  const [parsedResume, setParsedResume] = useState<ParsedResume | null>(null);

  const handleTextSubmit = useCallback((text: string) => {
    const parsed = parseResumeText(text);
    setParsedResume(parsed);
    setViewMode('preview');
  }, []);

  const handleResumeChange = useCallback((updated: ParsedResume) => {
    setParsedResume(updated);
  }, []);

  const handleReset = useCallback(() => {
    setViewMode('input');
    setParsedResume(null);
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative border-b border-zinc-800/50 backdrop-blur-xl bg-zinc-900/50 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white">Resume Formatter</h1>
                <p className="text-xs text-zinc-500">Paste • Edit • Download</p>
              </div>
            </div>

            {viewMode === 'preview' && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleReset}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Start Over
                </button>
                <DownloadButton 
                  filename={`${parsedResume?.contact.name?.replace(/\s+/g, '_') || 'resume'}.pdf`}
                  disabled={!parsedResume}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {viewMode === 'input' ? (
          /* Input View */
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-white mb-3">
                Transform Your Resume
              </h2>
              <p className="text-zinc-400 max-w-xl mx-auto">
                Paste your GPT-generated resume text below. Edit directly on the formatted 
                preview and download as a professional PDF.
              </p>
            </div>

            <div className="card p-6">
              <TextInput onSubmit={handleTextSubmit} />
            </div>

            {/* Features */}
            <div className="grid grid-cols-3 gap-4 mt-8">
              <div className="text-center p-4">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-zinc-800 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="font-medium text-white mb-1">Auto-Format</h3>
                <p className="text-xs text-zinc-500">Detects sections automatically</p>
              </div>
              <div className="text-center p-4">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-zinc-800 flex items-center justify-center">
                  <Edit3 className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="font-medium text-white mb-1">Click to Edit</h3>
                <p className="text-xs text-zinc-500">Edit directly on preview</p>
              </div>
              <div className="text-center p-4">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-zinc-800 flex items-center justify-center">
                  <Download className="w-6 h-6 text-green-400" />
                </div>
                <h3 className="font-medium text-white mb-1">PDF Export</h3>
                <p className="text-xs text-zinc-500">Download perfect PDFs</p>
              </div>
            </div>
          </div>
        ) : (
          /* Preview/Edit View - Single Screen */
          <div className="max-w-4xl mx-auto">
            {/* Instructions */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Edit3 className="w-4 h-4" />
                <span>Click any text to edit directly</span>
              </div>
              <div className="text-sm text-zinc-500">
                Press <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-xs">Enter</kbd> to save, 
                <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-xs ml-1">Shift+Enter</kbd> for new line
              </div>
            </div>

            {/* Editable Resume Preview */}
            {parsedResume && (
              <div className="overflow-auto bg-zinc-800 rounded-xl p-6" style={{ maxHeight: 'calc(100vh - 180px)' }}>
                <div className="shadow-2xl">
                  <EditableResumePreview
                    parsedResume={parsedResume}
                    onResumeChange={handleResumeChange}
                  />
                </div>
              </div>
            )}

            {/* Bottom Download Button (Mobile Friendly) */}
            <div className="mt-6 flex justify-center sm:hidden">
              <DownloadButton 
                filename={`${parsedResume?.contact.name?.replace(/\s+/g, '_') || 'resume'}.pdf`}
                disabled={!parsedResume}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="relative border-t border-zinc-800/50 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-xs text-zinc-600">
            Built for creating perfectly formatted resumes • Paste, Edit, Download
          </p>
        </div>
      </footer>
    </main>
  );
}
