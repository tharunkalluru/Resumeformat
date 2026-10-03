'use client';

import { useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Undo2, Redo2, Pilcrow, Heading1, Heading2 } from 'lucide-react';
import { DocumentNode } from '@/lib/document';

interface ResumeCanvasProps {
  document: DocumentNode;
  onDocumentChange: (document: DocumentNode) => void;
}

export default function ResumeCanvas({ document, onDocumentChange }: ResumeCanvasProps) {
  const [, updateToolbar] = useState(0);
  const editor = useEditor({
    extensions: [StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      blockquote: false, code: false, codeBlock: false, horizontalRule: false, strike: false,
    })],
    content: document,
    editorProps: { attributes: { class: 'resume-editor', 'aria-label': 'Editable resume document', role: 'textbox' } },
    onUpdate: ({ editor: current }) => onDocumentChange(current.getJSON() as DocumentNode),
    onSelectionUpdate: () => updateToolbar(value => value + 1),
  });

  if (!editor) return <div className="document-canvas" aria-busy="true" />;

  const command = (label: string, icon: React.ReactNode, action: () => void, active = false, disabled = false) => (
    <button type="button" key={label} aria-label={label} title={label} onClick={action} disabled={disabled}
      aria-pressed={active} className={`canvas-tool ${active ? 'canvas-tool-active' : ''}`}>{icon}</button>
  );

  return (
    <div className="canvas-shell">
      <div className="canvas-toolbar" role="toolbar" aria-label="Resume formatting">
        <div className="canvas-tool-group">
          {command('Undo', <Undo2 size={17} />, () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
          {command('Redo', <Redo2 size={17} />, () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
        </div>
        <div className="canvas-tool-group">
          {command('Paragraph', <Pilcrow size={17} />, () => editor.chain().focus().setParagraph().run(), editor.isActive('paragraph'))}
          {command('Name heading', <Heading1 size={17} />, () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
          {command('Section heading', <Heading2 size={17} />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        </div>
        <div className="canvas-tool-group">
          {command('Bold', <Bold size={17} />, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
          {command('Italic', <Italic size={17} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
          {command('Underline', <UnderlineIcon size={17} />, () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'))}
        </div>
        <div className="canvas-tool-group">
          {command('Bullet list', <List size={17} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
          {command('Numbered list', <ListOrdered size={17} />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
        </div>
        <span className="canvas-toolbar-hint">Select text to format · ⌘/Ctrl+Z to undo</span>
      </div>
      <div className="canvas-stage">
        <div className="document-canvas">
          <EditorContent editor={editor} />
        </div>
      </div>
      <div className="canvas-status">Letter width · The document expands as you write · PDF pages are added automatically</div>
    </div>
  );
}
