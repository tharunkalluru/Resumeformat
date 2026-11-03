import { describe, expect, it } from 'vitest';
import { fixtureProject } from '../core/testFixture';
import { matchProject } from './local';
import { addCareerNote, setJob } from '../core/commands';

describe('truthful local evidence matching', () => {
  it.each([
    'Never used Kubernetes.', 'No Kubernetes experience.', 'I do not have experience with Kubernetes.',
    "I haven't used Kubernetes.", 'I have not used Kubernetes or Docker.', 'Built React interfaces without Kubernetes.',
    'I lack Kubernetes experience.', 'Kubernetes: no experience.', "Kubernetes wasn't used.",
    'Used React but never used Kubernetes.', 'I can’t use Kubernetes.',
    'Kubernetes experience: none.', 'Kubernetes experience = none.', 'I have zero Kubernetes experience.',
    'I have zero experience with Kubernetes.',
  ])('keeps explicitly negated experience as a gap: %s', async text => {
    const project = setJob(addCareerNote(await fixtureProject(), text), { title: '', company: '', description: 'Kubernetes React' });
    const result = matchProject(project);
    expect(result.gaps).toContain('kubernetes');
    expect(result.evidence.every(e => !e.matchedTerms.includes('kubernetes'))).toBe(true);
  });
  it.each(['Used Kubernetes for a personal project.', 'Used not only Kubernetes but also Docker.', 'Never used Docker. Built Kubernetes deployments.', 'Achieved zero downtime with Kubernetes.', 'Used Kubernetes with zero service interruptions.'])('retains direct positive evidence: %s', async text => {
    const project = setJob(addCareerNote(await fixtureProject(), text), { title: '', company: '', description: 'Kubernetes' });
    const result = matchProject(project);
    expect(result.gaps).not.toContain('kubernetes');
    expect(result.evidence[0].text).toBe(text);
  });
  it('does not negate earlier positive experience when a later tool is explicitly excluded', async () => {
    const project = setJob(addCareerNote(await fixtureProject(), 'Built accessible interfaces without Kubernetes.'), { title: '', company: '', description: 'accessible Kubernetes' });
    const result = matchProject(project);
    expect(result.gaps).toContain('kubernetes'); expect(result.gaps).not.toContain('accessible');
  });
  it('returns exact known evidence and exposes unsupported requirements without invention', async () => {
    let project = await fixtureProject();
    project = setJob(project, { title: 'Engineer', company: 'Fictional', description: 'React TypeScript Kubernetes engineer. Kubernetes deployment.' });
    const result = matchProject(project);
    expect(result.evidence[0].text).toBe(project.facts[0].text);
    expect(result.evidence[0].matchedTerms).toContain('typescript');
    expect(result.gaps).toContain('kubernetes');
    expect(result.evidence.every(item => project.facts.some(fact => fact.id === item.factId && fact.text === item.text))).toBe(true);
    expect(project.draft.blocks[0].runs[0].text).not.toContain('Kubernetes');
  });
  it('matches optional applicant knowledge without silently replacing resume content', async () => {
    let project = await fixtureProject();
    const baseline = project.baseline.blocks[0].runs[0].text;
    project = addCareerNote(project, 'Used Kubernetes for a personal project.');
    project = setJob(project, { title: '', company: '', description: 'Kubernetes engineer' });
    const result = matchProject(project);
    expect(result.evidence[0].source).toBe('careerNote');
    expect(project.draft.blocks[0].runs[0].text).toBe(baseline);
  });
});
