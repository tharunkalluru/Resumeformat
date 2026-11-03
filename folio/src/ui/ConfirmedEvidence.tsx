import { useState } from 'react';

export function ConfirmedEvidence({ initial, targeted, onSave, onMemory }: { initial: string; targeted: boolean; onSave: (text: string) => void; onMemory: () => void }) {
  const [text, setText] = useState(initial), [confirmed, setConfirmed] = useState(false);
  return <form className="folio-evidence-form" onSubmit={event => { event.preventDefault(); if (text.trim() && confirmed) onSave(text); }}>
    <p>{targeted ? 'Review the complete paragraph below. Confirm only work, results and qualifications you can substantiate.' : 'Add your own relevant experience. Posting terms are prompts to review, never evidence that you have a qualification.'}</p>
    <label>Your exact career fact<textarea autoFocus maxLength={10000} rows={7} value={text} onChange={event => { setText(event.target.value); setConfirmed(false); }} /></label>
    <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm this exact wording is accurate about my experience.</label>
    <p className="subtle">This confirmed note belongs only to this tailoring. Private workspace notes are separate and are never evidence. Use Career Memory to save context for future jobs.</p>
    <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onMemory}>Open Career Memory</button><button className="button button-primary" disabled={!confirmed || !text.trim()}>{targeted ? 'Confirm and use this wording' : 'Save confirmed fact'}</button></div>
  </form>;
}
