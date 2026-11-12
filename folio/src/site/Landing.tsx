import { ArrowRight, Lock, ShieldCheck } from 'lucide-react';
import { useOptionalAuth } from '../auth/AuthProvider';
import { SiteFooter, SiteHeader } from './Site';
import { linkProps, navigate } from './router';

const STEPS = [
  { title: 'Add your resume', text: 'Drop in your PDF or Word file. Folio reads it into a clean template while you find the job posting.' },
  { title: 'Paste the job', text: 'Paste the posting, or a link to it. Folio rewrites, reorders and trims your resume for that job.' },
  { title: 'Check and download', text: 'Changes arrive applied and highlighted. Undo any you don’t want, then download a PDF or Word file.' },
];

const PROMISES = [
  { title: 'Only what’s true', text: 'Every change is built from your own resume. Folio never adds a title, number, tool or skill you didn’t write, and holds back any suggestion that tries to.' },
  { title: 'Every change is yours to undo', text: 'Each change shows the old line, the new line and the reason. Undo one, undo all, or click any line on the resume to reword it yourself.' },
  { title: 'Clean templates that get read', text: 'Three one-column templates with real text and standard headings, which applicant-tracking systems read correctly. Files stay under 100 KB.' },
];

const FAQ = [
  { q: 'Is Folio free?', a: 'Yes. Your first tailoring needs no account. A free account gives you a daily allowance of tailorings and cover letters while Folio is in early access.' },
  { q: 'Where is my resume stored?', a: 'In your browser. If you’re signed in, a copy is also saved to your account, in the region you chose (India or the United States), so your resumes and jobs follow you to any device. You can turn that off from the menu.' },
  { q: 'What is sent to the AI?', a: 'The text of your resume and the job posting, through Folio’s server to OpenAI, with OpenAI’s storage turned off. Your file itself is never uploaded.' },
  { q: 'Do I need an account?', a: 'Not for your first tailoring. You need one to tailor more jobs, to write cover letters, and to keep your resumes across devices.' },
  { q: 'Can I keep my own resume design?', a: 'Yes. The exact-layout workspace, in the menu, edits your original file in place instead of using a template.' },
];

export function Landing() {
  const auth = useOptionalAuth();
  const startFree = () => auth ? auth.openAuth('signup') : navigate('app');
  const tryNow = () => navigate('app');
  const signIn = () => auth ? auth.openAuth('signin') : navigate('app');
  const trySample = () => { window.history.pushState(null, '', '/app?sample=1'); window.dispatchEvent(new PopStateEvent('popstate')); };

  return <div className="site">
    <SiteHeader>
      <a className="site-nav-link" href="#how">How it works</a>
      <a className="site-nav-link" href="#faq">FAQ</a>
      <button type="button" className="site-nav-link site-text-button" onClick={signIn}>Sign in</button>
      <button type="button" className="site-button site-button-small" onClick={tryNow}>Get started</button>
    </SiteHeader>

    <main id="main">
      <section className="site-hero">
        <div className="site-hero-copy">
          <p className="site-eyebrow">Resume tailoring</p>
          <h1>Tailor your resume to every job, using only what’s true.</h1>
          <p className="site-lead">Folio rewrites and reorders your resume for each job using only your real experience, then gives you a clean PDF or Word file in about a minute.</p>
          <div className="site-actions">
            <button type="button" className="site-button" onClick={tryNow}>Tailor my resume free <ArrowRight size={16} aria-hidden="true" /></button>
            <button type="button" className="site-button site-button-ghost" onClick={trySample}>Try a sample resume</button>
          </div>
          <p className="site-fineprint"><Lock size={13} aria-hidden="true" /> No credit card. Your first tailoring needs no account.</p>
        </div>
        <div className="site-hero-art" aria-hidden="true">
          <div className="site-paper">
            <div className="site-paper-name">Alex Morgan</div>
            <div className="site-paper-role">Product Manager · Pune</div>
            <div className="site-paper-rule" />
            <div className="site-paper-head">Experience</div>
            <div className="site-paper-job">Northwind Analytics <span>2022 – Present</span></div>
            <div className="site-line site-line-old">Led roadmap for the reporting product across three teams.</div>
            <div className="site-line site-line-new">Owned the reporting roadmap across three teams, prioritising enterprise customer requests.</div>
            <div className="site-line">Cut report load time by redesigning the export flow with engineering.</div>
            <div className="site-skel" /><div className="site-skel site-skel-short" />
            <div className="site-paper-head">Skills</div>
            <div className="site-skel" /><div className="site-skel site-skel-short" />
          </div>
          <div className="site-badge"><ShieldCheck size={14} /> Reworded for the job, nothing invented</div>
        </div>
      </section>

      <section id="how" className="site-section">
        <h2>How it works</h2>
        <ol className="site-steps">
          {STEPS.map(({ title, text }) => <li key={title}><h3>{title}</h3><p>{text}</p></li>)}
        </ol>
      </section>

      <section className="site-section site-band">
        <h2>Built to be trusted</h2>
        <ul className="site-promises">
          {PROMISES.map(item => <li key={item.title}><h3>{item.title}</h3><p>{item.text}</p></li>)}
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
