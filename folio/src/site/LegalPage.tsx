import { SiteFooter, SiteHeader } from './Site';
import { linkProps } from './router';

const UPDATED = 'November 4, 2026';
const CONTACT = 'tharun99.kalluru@gmail.com';

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  return <div className="site">
    <SiteHeader><a className="site-button site-button-small" {...linkProps('app')}>Open Folio</a></SiteHeader>
    <main className="site-main site-narrow site-legal">{kind === 'privacy' ? <Privacy /> : <Terms />}</main>
    <SiteFooter />
  </div>;
}

function Privacy() {
  return <>
    <h1>Privacy policy</h1>
    <p className="site-fineprint">Last updated {UPDATED}</p>
    <p>Folio helps you tailor your resume to job descriptions. This policy explains what Folio collects, where it is kept and how you can remove it.</p>

    <h2>What stays on your device</h2>
    <p>Your resume files, drafts, applications, career notes and downloads are stored in your browser’s storage on your device. They are not uploaded to Folio’s servers. Clearing your browser data removes them.</p>

    <h2>Your account</h2>
    <p>If you create an account, Folio stores your email address, your name, and your profile picture if you sign in with Google. This is kept with our database provider, Supabase, in the region you choose when signing up: India (Mumbai) or the United States (Ohio). Your account lives in one region only.</p>

    <h2>AI suggestions</h2>
    <p>When you ask for AI suggestions, Folio sends the job description and the resume lines and facts you selected to OpenAI through Folio’s server, to generate wording suggestions. Nothing is sent until you choose to request suggestions. Requests are made with OpenAI’s storage turned off. Folio does not keep the content of these requests. It keeps a short record of each request (time, status, and amount of AI usage) to apply daily limits.</p>

    <h2>Sign-in with Google</h2>
    <p>If you use Google to sign in, Folio receives your name, email address and profile picture from Google. Folio does not access your Gmail, Drive, contacts or any other Google data. Folio’s use of information received from Google follows the Google API Services User Data Policy, including its Limited Use requirements.</p>

    <h2>Cookies and storage</h2>
    <p>Folio uses your browser’s local storage to keep you signed in and to remember your region. Folio does not use advertising or tracking cookies, and does not sell or share your information for advertising.</p>

    <h2>Service providers</h2>
    <ul>
      <li>Supabase — accounts and sign-in</li>
      <li>OpenAI — AI wording suggestions</li>
      <li>Cloudflare — hosting the website</li>
      <li>Google — optional sign-in</li>
    </ul>

    <h2>Deleting your data</h2>
    <p>You can delete your resumes and drafts at any time from Folio or by clearing your browser data. To delete your account, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address on your account and it will be removed within 30 days.</p>

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
    <p>Folio is an early-access tool for editing and tailoring resumes. It is provided free of charge, as is, and may change or be unavailable at times. AI suggestions are limited per day.</p>

    <h2>Your content</h2>
    <p>You own your resume and everything you create with Folio. You give Folio permission to process it only to provide the service, such as sending selected text for AI suggestions when you ask.</p>

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
