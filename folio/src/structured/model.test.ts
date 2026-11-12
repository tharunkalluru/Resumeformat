import { describe, expect, it } from 'vitest';
import { applyTailoring, clean, jobHeading, jobMatch, suggestionKeys, withIds, type StructuredResume, type Tailoring } from './model';
// The server-side checks are plain JavaScript shared with the edge function.
// @ts-expect-error no type declarations for the edge function module
import { checkStructure, checkTailoring, corpus, ungrounded, validResume } from '../../../supabase/functions/resume-ai/structured.mjs';

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
