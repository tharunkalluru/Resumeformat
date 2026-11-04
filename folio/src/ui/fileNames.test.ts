import { describe, expect, it } from 'vitest';
import { defaultResumeFileName } from './fileNames';

describe('download file names', () => {
  it('uses Company-Role without repeating the role', () => {
    expect(defaultResumeFileName({ name: 'Senior PM, Platform at Acme', job: { title: 'Senior PM, Platform', company: 'Acme', description: '' } })).toBe('Acme-Senior-PM-Platform');
  });
  it('falls back to whichever of company or role exists, then the project name', () => {
    expect(defaultResumeFileName({ name: 'x', job: { title: 'Designer', company: '', description: '' } })).toBe('Designer');
    expect(defaultResumeFileName({ name: 'Casey resume', job: { title: '', company: '', description: '' } })).toBe('Casey-resume');
  });
});
