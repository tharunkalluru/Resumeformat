import React from 'react';
import { createRoot } from 'react-dom/client';
import { Site } from './site/Site';
import { AuthProvider } from './auth/AuthProvider';
import './styles.css';

class WorkspaceBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main style={{ maxWidth: 560, margin: '15vh auto', padding: 32 }}>
      <h1 style={{ fontSize: 24 }}>The workspace could not continue.</h1>
      <p style={{ margin: '16px 0', fontSize: 14 }}>Saved projects remain in device storage. Reload to recover the last successful save. Unsaved edits may not be recoverable.</p>
      <button className="button button-primary" onClick={() => window.location.reload()}>Reload workspace</button>
    </main>;
  }
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><WorkspaceBoundary><AuthProvider><Site /></AuthProvider></WorkspaceBoundary></React.StrictMode>);
