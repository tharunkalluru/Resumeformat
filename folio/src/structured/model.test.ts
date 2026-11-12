import { describe, expect, it } from 'vitest';
import { applyTailoring, clean, fromV1, jobHeading, jobMatch, mergeResume, newJob, newResume, sameContent, suggestionKeys, withIds, withJob, withoutJob, type StructuredResume, type Tailoring } from './model';
import { jobLink } from './api';
// The server-side checks are plain JavaScript shared with the edge function.
// @ts-expect-error no type declarations for the edge function module
import { checkLetter, checkStructure, checkTailoring, corpus, htmlToJobText, safeJobUrl, ungrounded, validResume } from '../../../supabase/functions/resume-ai/structured.mjs';

const resume: StructuredResume = {
  name: 'Casey Rowan', headline: 'Product Designer', contact: ['casey@example.com'], summary: 'Product designer focused on accessible interfaces and clear design systems.',
  experience: [{ id: 'r1', title: 'Product Designer', company: 'Northstar Studio', location: '', dates: '2021 – Present', bullets: [
    { id: 'b1', text: 'Designed accessible onboarding flows for a scheduling product.' },
    { id: 'b2', text: 'Built a reusable design system in Figma with engineering partners.' },
    { id: 'b3', text: 'Cut support tickets by 30% with clearer settings screens.' },
    { id: 'b4', text: 'Organised the team offsite.' }] }],
  education: [], skills: [{ id: 's1', label: '', items: ['Product design', 'Figma', 'Prototyping', 'Accessibility'] }], projects: [], extras: [],
};
const job = 'Design accessible dashboards and design systems for B2B SaaS. Figma, Kubernetes, stakeholder management.';
const proposal = {
  summary: { text: 'Product designer focused on accessible interfaces, design systems and B2B dashboards.', reason: '' },
  bullets: [
    { id: 'b2', text: 'Built a reusable Figma design system with engineering partners.', reason: 'design systems' },
    { id: 'b1', text: 'Designed accessible dashboards for a scheduling product.', reason: '' },
    { id: 'b3', text: 'Cut support tickets by 45% with clearer settings screens.', reason: '' },
    { id: 'nope', text: 'Anything', reason: '' }],
  cuts: [{ id: 'b4', reason: 'not relevant' }],
  order: [{ parentId: 'r1', ids: ['b2', 'b1', 'b3', 'b4'] }],
  skills: [{ groupId: 's1', items: ['Accessibility', 'figma', 'Kubernetes'] }],
  missing: ['B2B SaaS'],
};

describe('structured resume: server checks', () => {
  it('keeps only suggestions made of the resume’s own words and numbers', () => {
    const checked = checkTailoring(proposal, resume, job) as Tailoring;
    expect(checked.bullets.map(item => item.id)).toEqual(['b2']);
    expect(checked.summary).toBeNull();
    expect(checked.dropped).toEqual({ job_word: 1, number: 1, reference: 1, term: 1 });
    expect(checked.cuts.map(item => item.id)).toEqual(['b4']);
    expect(checked.skills).toEqual([{ groupId: 's1', items: ['Accessibility', 'Figma'] }]);
  });
  it('names the reason a line cannot be shown', () => {
    const source = corpus('Built flows with React. Cut load time by 30%.'), posting = corpus('Kubernetes and dashboards');
    expect(ungrounded('Cut load time by 30% using React.', source, posting)).toBeNull();
    expect(ungrounded('Cut load time by 40%.', source, posting)).toBe('number');
    expect(ungrounded('Built dashboards.', source, posting)).toBe('job_word');
    expect(ungrounded('Built flows for Acme.', source, posting)).toBe('name');
  });
  it('rejects a reading that is not the resume’s text, and a malformed resume', () => {
    expect(checkStructure({ name: 'Casey Rowan', summary: 'Designed accessible onboarding flows' }, 'Casey Rowan\nDesigned accessible onboarding flows')).toBeNull();
    expect(checkStructure({ name: 'Casey Rowan', summary: 'Led a global platform team at Initech for a decade' }, 'Casey Rowan\nDesigned accessible onboarding flows')).toBe('not_from_resume');
    expect(validResume(resume)).toBe(true);
    expect(validResume({ ...resume, experience: [{ title: 'x' }] })).toBe(false);
  });
});

describe('structured resume: applying decisions', () => {
  const tailoring = checkTailoring(proposal, resume, job) as Tailoring;
  it('applies nothing until a suggestion is accepted', () => {
    expect(applyTailoring(resume, tailoring, {})).toEqual(resume);
    expect(applyTailoring(resume, tailoring, { 'bullet:b2': 'rejected' })).toEqual(resume);
  });
  it('applies accepted rewrites, cuts, order and skills', () => {
    const next = applyTailoring(resume, tailoring, Object.fromEntries(suggestionKeys(tailoring).map(key => [key, 'accepted' as const])));
    expect(next.experience[0].bullets.map(bullet => bullet.id)).toEqual(['b2', 'b1', 'b3']);
    expect(next.experience[0].bullets[0].text).toBe('Built a reusable Figma design system with engineering partners.');
    expect(next.skills[0].items).toEqual(['Accessibility', 'Figma']);
    expect(resume.experience[0].bullets).toHaveLength(4);
  });
  it('adds ids on reading, drops blank lines, and reports job-term coverage', () => {
    const read = withIds({ name: ' A ', headline: '', contact: [' a@b.co ', ''], summary: '', experience: [{ title: 'T', company: 'C', location: '', dates: '', bullets: ['one', ' '] }], education: [], skills: [{ label: '', items: [] }], projects: [], extras: [] });
    expect(read.name).toBe('A'); expect(read.contact).toEqual(['a@b.co']); expect(read.experience[0].bullets).toHaveLength(1); expect(read.skills).toHaveLength(0);
    expect(clean({ ...resume, experience: [{ ...resume.experience[0], bullets: [{ id: 'x', text: '  ' }] }] }).experience[0].bullets).toHaveLength(0);
    const match = jobMatch(resume, job);
    expect(match.found).toContain('figma'); expect(match.absent).toContain('kubernetes');
  });
  it('reads role and company from the posting’s first line when it can', () => {
    expect(jobHeading('Senior Product Manager, Platform at Acme. We are looking for a PM.')).toEqual({ title: 'Senior Product Manager, Platform', company: 'Acme' });
    expect(jobHeading('Product Designer | Northstar Studio\nAbout the role')).toEqual({ title: 'Product Designer', company: 'Northstar Studio' });
    expect(jobHeading('We are a fast-growing company; you will own the roadmap and work with engineering every day of the week.')).toEqual({ title: '', company: '' });
  });
});

describe('structured resume: job links, cover letters and the posting’s own title', () => {
  it('reads role and company only when the posting really says them', () => {
    const checked = checkTailoring({ ...proposal, job: { title: 'Design accessible dashboards', company: 'Initech' } }, resume, job) as Tailoring;
    expect(checked.job).toEqual({ title: 'Design accessible dashboards', company: '' });
  });
  it('accepts only public https pages by name', () => {
    expect(safeJobUrl('https://jobs.example.org/role/42')?.hostname).toBe('jobs.example.org');
    for (const bad of ['http://jobs.example.org/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://intranet/x', 'https://files.internal/x', 'https://jobs.example.org:8443/x', 'https://user:pw@jobs.example.org/x', 'https://[::1]/x', 'ftp://jobs.example.org', 'not a link'])
      expect(safeJobUrl(bad), bad).toBeNull();
    expect(jobLink(' https://jobs.example.org/role/42 ')).toBe('https://jobs.example.org/role/42');
    expect(jobLink('http://jobs.example.org/a')).toBe('https://jobs.example.org/a');
    expect(jobLink('Senior designer https://jobs.example.org/a')).toBeNull();
  });
  it('prefers a page’s published job data and otherwise its visible text', () => {
    const description = '<p>Own the design system.</p><ul><li>Figma</li><li>Accessibility &amp; research</li></ul>' + '<p>We value clear thinking and careful work.</p>'.repeat(6);
    const page = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Product Designer', hiringOrganization: { name: 'Northstar' }, description })}</script></head><body><nav>Menu</nav>Other</body></html>`;
    const text = htmlToJobText(page) as string;
    expect(text.startsWith('Product Designer at Northstar')).toBe(true); expect(text).toContain('Accessibility & research'); expect(text).not.toContain('<');
    expect(htmlToJobText(`<body><script>var x = 1</script><h1>Designer</h1>${'<p>Design accessible dashboards with the team.</p>'.repeat(12)}</body>`)).toContain('Designer\n');
    expect(htmlToJobText('<body><p>Please enable JavaScript.</p></body>')).toBeNull();
  });
  it('rejects a letter with a figure or a name that is in neither the resume nor the posting', () => {
    const letter = (claim: string) => ({ letter: `Dear Hiring Manager,\n\nI am applying for the design role because accessible dashboards and design systems are the work I do at Northstar Studio. ${claim} I built a reusable design system in Figma with engineering partners and designed accessible onboarding flows for a scheduling product.\n\nI would welcome a conversation.\n\nCasey Rowan` });
    expect(checkLetter(letter('I cut support tickets by 30% with clearer settings screens.'), resume, job).problem).toBeNull();
    expect(checkLetter(letter('I cut support tickets by 45% with clearer settings screens.'), resume, job).problem).toBe('number');
    expect(checkLetter(letter('I also led design at Initech for years.'), resume, job).problem).toBe('name');
    expect(checkLetter({ letter: 'Too short.' }, resume, job).problem).toBe('length');
  });
});

describe('structured resume: saved jobs', () => {
  const tailoring = checkTailoring(proposal, resume, job) as Tailoring;
  it('saves a tailoring as a job with its changes applied, and keeps the applicant’s own rewording on top', () => {
    const made = newJob({ title: 'Designer', company: 'Acme', description: job }, tailoring);
    expect(Object.values(made.decisions).every(value => value === 'accepted')).toBe(true);
    const own = applyTailoring(resume, tailoring, made.decisions, { 'bullet:b2': 'My own wording.', 'bullet:b3': '', summary: 'My summary.' });
    expect(own.experience[0].bullets.map(bullet => bullet.text)).toEqual(['My own wording.', 'Designed accessible onboarding flows for a scheduling product.']);
    expect(own.summary).toBe('My summary.');
  });
  it('adds, replaces and removes jobs without touching the others', () => {
    const first = newJob({ title: 'A', company: '', description: 'a' }, tailoring), second = newJob({ title: 'B', company: '', description: 'b' }, tailoring);
    let record = withJob(withJob(newResume('cv.pdf', resume), first), second);
    expect(record.jobs.map(item => item.job.title)).toEqual(['B', 'A']);
    record = withJob(record, { ...first, status: 'applied' });
    expect(record.jobs.find(item => item.id === first.id)?.status).toBe('applied'); expect(record.jobs).toHaveLength(2);
    record = withoutJob(record, second.id);
    expect(record.jobs.map(item => item.id)).toEqual([first.id]); expect(record.deletedJobs).toEqual([second.id]);
  });
  it('carries over a resume saved by the earlier workspace', () => {
    const old = { projectId: 'file:1', sourceName: 'cv.pdf', base: resume, updatedAt: '2026-11-01T00:00:00.000Z', job: { title: 'Designer', company: 'Acme', description: job }, tailoring, decisions: { 'bullet:b2': 'accepted' as const } };
    const moved = fromV1(old);
    expect(moved.jobs).toHaveLength(1); expect(moved.jobs[0].decisions).toEqual({ 'bullet:b2': 'accepted' }); expect(moved.jobs[0].job.company).toBe('Acme');
    expect(fromV1({ ...old, tailoring: null }).jobs).toHaveLength(0);
  });
  it('merges two copies: newer resume text wins, every job is kept, deleted jobs stay deleted', () => {
    const base = newResume('cv.pdf', resume), a = newJob({ title: 'A', company: '', description: 'a' }, tailoring), b = newJob({ title: 'B', company: '', description: 'b' }, tailoring), c = newJob({ title: 'C', company: '', description: 'c' }, tailoring);
    const phone = { ...base, updatedAt: '2026-11-02T00:00:00.000Z', jobs: [a, c], base: { ...resume, headline: 'Senior Product Designer' } };
    const laptop = { ...base, updatedAt: '2026-11-03T00:00:00.000Z', jobs: [{ ...a, status: 'applied' as const, updatedAt: '2099-01-01T00:00:00.000Z' }, b], deletedJobs: [c.id] };
    const merged = mergeResume(phone, laptop);
    expect(merged.base.headline).toBe('Product Designer');
    expect(merged.jobs.map(item => item.job.title).sort()).toEqual(['A', 'B']);
    expect(merged.jobs.find(item => item.id === a.id)?.status).toBe('applied');
    expect(mergeResume(laptop, phone)).toEqual(merged);
    expect(sameContent(merged, { ...merged, synced: { user: 'u', at: 'x' } })).toBe(true); expect(sameContent(merged, phone)).toBe(false);
    const { id, ...rest } = merged; expect(sameContent(merged, { ...rest, id } as typeof merged)).toBe(true);
  });
});
