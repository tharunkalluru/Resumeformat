import { describe, expect, it } from 'vitest';
import { friendlyAuthError, passwordProblem, validEmail } from './authActions';
import { isRegionId } from './regions';

describe('auth helpers', () => {
  it('requires 8+ characters mixing letters and numbers', () => {
    expect(passwordProblem('short1')).toMatch(/8 characters/);
    expect(passwordProblem('lettersonly')).toMatch(/letters and numbers/);
    expect(passwordProblem('letters123')).toBeNull();
  });
  it('validates email shape', () => {
    expect(validEmail(' person@example.com ')).toBe(true);
    expect(validEmail('person@')).toBe(false);
  });
  it('turns provider errors into plain language', () => {
    expect(friendlyAuthError(new Error('Invalid login credentials'))).toMatch(/don’t match an account/);
    expect(friendlyAuthError(new Error('Email not confirmed'))).toMatch(/confirm your email/);
    expect(friendlyAuthError(new Error('Failed to fetch'))).toMatch(/connection/);
  });
  it('only accepts known regions', () => {
    expect(isRegionId('in')).toBe(true);
    expect(isRegionId('eu')).toBe(false);
  });
});
