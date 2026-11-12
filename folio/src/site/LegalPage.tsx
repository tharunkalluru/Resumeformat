import { SiteFooter, SiteHeader } from './Site';
import { linkProps } from './router';

const UPDATED = 'November 12, 2026';
const CONTACT = 'tharun99.kalluru@gmail.com';

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  return <div className="site">
    <SiteHeader><a className="site-button site-button-small" {...linkProps('app')}>Open Folio</a></SiteHeader>
    <main id="main" className="site-main site-narrow site-legal">{kind === 'privacy' ? <Privacy /> : <Terms />}</main>
    <SiteFooter />
  </div>;
}

function Privacy() {
  return <>
    <h1>Privacy policy</h1>
    <p className="site-fineprint">Last updated {UPDATED}</p>
    <p>Folio helps you tailor your resume to job descriptions. This policy explains what Folio collects, where it is kept and how you can remove it.</p>

    <h2>Your resumes</h2>
    <p>The file you add is opened in your browser and is never uploaded; Folio works from its text. Your resumes, the versions tailored for each job, and cover letters are stored in your browser’s storage on your device.</p>
    <p>If you are signed in, a copy of your resumes, tailored versions, job postings and cover letters is also saved to your account, so they are there on your other devices. You can turn this off under “Save to my account” in the menu: the copies in your account are deleted and nothing more is saved there. When you sign out, resumes that are saved in your account are removed from that browser.</p>
    <p>The older exact-layout workspace keeps everything in your browser only.</p>

    <h2>Career memory</h2>
    <p>Career memory is where you can keep more about your work than one resume holds: notes, the text of documents you add, your LinkedIn profile if you paste or export it, your public GitHub projects, the text of a web page about your work, and dictated notes. It is stored like your resumes: in your browser, and in your account if you are signed in and saving to your account is on. You can edit or delete any item at any time.</p>
    <p>When you import GitHub projects, your browser asks GitHub directly for the public repositories of the username you enter. When you dictate, your browser’s own speech service turns your voice into text; Folio receives only the text you save.</p>

    <h2>Your account</h2>
    <p>If you create an account, Folio stores your email address, your name, and your profile picture if you sign in with Google. This, and the copies of your resumes described above, is kept with our database provider, Supabase, in the region you choose when signing up: India (Mumbai) or the United States (Ohio). Your account lives in one region only.</p>

    <h2>AI</h2>
    <p>Folio uses AI to read your resume into sections, to tailor it to a job, and to draft a cover letter. For this, the text of your resume, the job posting, and the parts of your career memory that are relevant to that posting are sent through Folio’s server to OpenAI. The text of your resume is sent when you add it; the job posting is sent when you ask for a tailoring. Requests are made with OpenAI’s storage turned off. Folio’s server does not keep the content of these requests. It keeps a short record of each request (time, status, and amount of AI usage) to apply daily limits.</p>
    <p>If you paste a link to a job posting or to a page about your work, Folio’s server reads that one page, or the hiring platform’s public feed for that posting, identifying itself as Folio. It does not sign in anywhere and does not read sites that refuse it. The optional “Send to Folio” bookmark runs in your own browser and sends Folio only the posting on the page you are looking at when you click it.</p>

    <h2>Trying Folio without an account</h2>
    <p>You can tailor one resume without an account. To limit this to one try per visitor, Folio’s server keeps a one-way scrambled form of your internet address, which cannot be turned back into the address, and deletes it within three days.</p>

    <h2>Sign-in with Google</h2>
    <p>If you use Google to sign in, Folio receives your name, email address and profile picture from Google. Folio does not access your Gmail, Drive, contacts or any other Google data. Folio’s use of information received from Google follows the Google API Services User Data Policy, including its Limited Use requirements.</p>

    <h2>Cookies and storage</h2>
    <p>Folio uses your browser’s local storage to keep you signed in and to remember your region and paper size. Folio does not use advertising or tracking cookies, and does not sell or share your information for advertising.</p>

    <h2>Service providers</h2>
    <ul>
      <li>Supabase — accounts, sign-in and the copies of resumes and career memory saved to your account</li>
      <li>OpenAI — reading, tailoring and cover-letter drafts</li>
      <li>Cloudflare — hosting the website</li>
      <li>Google — optional sign-in</li>
    </ul>

    <h2>Deleting your data</h2>
    <p>You can delete any resume or job from Folio at any time; if it was saved to your account, that copy is deleted too. Clearing your browser data removes what is stored on your device. To delete your account, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address on your account and it will be removed within 30 days.</p>

    <h2>Children</h2>
    <p>Folio is not intended for anyone under 16.</p>

    <h2>Changes and contact</h2>
    <p>If this policy changes, the date above will be updated. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
  </>;
}

function Terms() {
  return <>
    <h1>Terms of use</h1>
    <p className="site-fineprint">Last updated {UPDATED}</p>
    <p>By using Folio you agree to these terms. If you do not agree, please do not use Folio.</p>

    <h2>The service</h2>
    <p>Folio is an early-access tool for editing and tailoring resumes. It is provided free of charge, as is, and may change or be unavailable at times. AI use is limited per day.</p>

    <h2>Your content</h2>
    <p>You own your resume and everything you create with Folio. You give Folio permission to process it only to provide the service: sending your resume text and job postings to the AI provider, and keeping copies in your account while that setting is on.</p>

    <h2>Your responsibility</h2>
    <p>AI suggestions can be wrong. Review every change before you use it, and make sure your resume is true and accurate. Do not use Folio to misrepresent your experience, to upload content you do not have the right to use, or to misuse or overload the service.</p>

    <h2>Accounts</h2>
    <p>Keep your sign-in details safe. Folio may suspend accounts that misuse the service.</p>

    <h2>No warranty and limits of liability</h2>
    <p>Folio is provided without warranties of any kind. To the extent allowed by law, Folio is not liable for indirect or consequential losses, including outcomes of job applications.</p>

    <h2>Changes and contact</h2>
    <p>These terms may be updated; the date above shows the latest version. Read the <a {...linkProps('privacy')}>privacy policy</a> for how data is handled. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
  </>;
}
