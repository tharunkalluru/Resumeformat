import { ArrowRight, Check, FileText, Lock, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import { useOptionalAuth } from '../auth/AuthProvider';
import { SiteFooter, SiteHeader } from './Site';
import { linkProps, navigate } from './router';

const STEPS = [
  { icon: Upload, title: 'Add your resume', text: 'Drop in your PDF or Word file. Folio keeps your exact layout, fonts and spacing.' },
  { icon: FileText, title: 'Paste the job', text: 'Add the job description. Folio finds which of your experiences match what they ask for.' },
  { icon: Sparkles, title: 'Review and download', text: 'Accept the suggested wording you like, check the page, and download a PDF that looks like yours.' },
];

const PROMISES = [
  { title: 'Your layout stays yours', text: 'No reformatting into a generic template. The download matches the resume you uploaded, line for line.' },
  { title: 'Only facts you gave it', text: 'Suggestions are built from your own resume and notes. Folio never invents titles, numbers or skills.' },
  { title: 'You approve every change', text: 'Each suggestion shows what changed and why. Nothing is applied until you accept it.' },
];

const FAQ = [
  { q: 'Is Folio free?', a: 'Yes. Editing and downloading are free. AI suggestions are free within a daily limit while Folio is in early access.' },
  { q: 'Where is my resume stored?', a: 'Your resume and drafts are kept in your browser on your device. Your account details live in the region you choose: India or the United States.' },
  { q: 'What is sent to the AI?', a: 'Only the job description and the resume lines you choose for a suggestion, sent through Folio’s server to OpenAI. Nothing is sent until you ask for suggestions.' },
  { q: 'Do I need an account?', a: 'You can try Folio and download without one. An account is needed for AI suggestions.' },
];

export function Landing() {
  const auth = useOptionalAuth();
  const startFree = () => auth ? auth.openAuth('signup') : navigate('app');
  const signIn = () => auth ? auth.openAuth('signin') : navigate('app');
  const trySample = () => { window.history.pushState(null, '', '/app?sample=1'); window.dispatchEvent(new PopStateEvent('popstate')); };

  return <div className="site">
    <SiteHeader>
      <a className="site-nav-link" href="#how">How it works</a>
      <a className="site-nav-link" href="#faq">FAQ</a>
      <button type="button" className="site-nav-link site-text-button" onClick={signIn}>Sign in</button>
      <button type="button" className="site-button site-button-small" onClick={startFree}>Get started</button>
    </SiteHeader>

    <main>
      <section className="site-hero">
        <div className="site-hero-copy">
          <p className="site-eyebrow">Resume tailoring that respects your work</p>
          <h1>Tailor your resume to every job, without losing your layout.</h1>
          <p className="site-lead">Folio rewrites the lines that matter for each job using only your real experience, then gives you back a PDF that looks exactly like yours.</p>
          <div className="site-actions">
            <button type="button" className="site-button" onClick={startFree}>Get started free <ArrowRight size={16} aria-hidden="true" /></button>
            <button type="button" className="site-button site-button-ghost" onClick={trySample}>Try a sample resume</button>
          </div>
          <p className="site-fineprint"><Lock size={13} aria-hidden="true" /> No credit card. Your resume stays on your device.</p>
        </div>
        <div className="site-hero-art" aria-hidden="true">
          <div className="site-paper">
            <div className="site-paper-name">Alex Morgan</div>
            <div className="site-paper-role">Product Manager</div>
            <div className="site-paper-rule" />
            <div className="site-paper-head">Experience</div>
            <div className="site-line site-line-old">Led roadmap for the reporting product across three teams.</div>
            <div className="site-line site-line-new"><Sparkles size={12} /> Owned the reporting roadmap across three teams, prioritising enterprise customer requests.</div>
            <div className="site-line" />
            <div className="site-line site-line-short" />
            <div className="site-paper-head">Skills</div>
            <div className="site-line" />
            <div className="site-line site-line-short" />
          </div>
          <div className="site-badge"><ShieldCheck size={14} /> Matches your source resume</div>
        </div>
      </section>

      <section id="how" className="site-section">
        <h2>How it works</h2>
        <ol className="site-steps">
          {STEPS.map(({ icon: Icon, title, text }, index) => <li key={title}>
            <span className="site-step-icon"><Icon size={18} aria-hidden="true" /></span>
            <span className="site-step-number">Step {index + 1}</span>
            <h3>{title}</h3><p>{text}</p>
          </li>)}
        </ol>
      </section>

      <section className="site-section site-band">
        <h2>Built to be trusted</h2>
        <ul className="site-promises">
          {PROMISES.map(item => <li key={item.title}><Check size={18} aria-hidden="true" /><div><h3>{item.title}</h3><p>{item.text}</p></div></li>)}
        </ul>
      </section>

      <section id="faq" className="site-section site-narrow">
        <h2>Questions</h2>
        {FAQ.map(item => <details key={item.q} className="site-faq"><summary>{item.q}</summary><p>{item.a}</p></details>)}
        <p className="site-fineprint site-faq-note">More detail in the <a {...linkProps('privacy')}>privacy policy</a>.</p>
      </section>

      <section className="site-section site-cta">
        <h2>Your next application, tailored in minutes.</h2>
        <div className="site-actions site-actions-center">
          <button type="button" className="site-button" onClick={startFree}>Create your free account</button>
          <button type="button" className="site-button site-button-ghost" onClick={trySample}>Try a sample first</button>
        </div>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
