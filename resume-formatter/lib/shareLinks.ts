/**
 * Share Link Configuration
 *
 * Maps secure tokens to email addresses.
 * Tokens are cryptographically random and cannot be guessed.
 */

// Secure token-to-email mapping (server-side only)
const SHARE_LINK_CONFIG: Record<string, string> = {
  // Link A - Primary email
  't99.k': 'tharun99.kalluru@gmail.com',
  // Link B - Secondary email
  'tk99': 'tharunkalluru99@gmail.com',
};

// Valid tokens list (for validation without exposing emails)
const VALID_TOKENS = new Set(Object.keys(SHARE_LINK_CONFIG));

/**
 * Validate if a token is a valid share link token
 */
export function isValidShareToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  return VALID_TOKENS.has(token);
}

/**
 * Get the email for a share token (server-side only)
 * Returns null for invalid tokens
 */
export function getEmailForToken(token: string): string | null {
  if (!isValidShareToken(token)) return null;
  return SHARE_LINK_CONFIG[token] || null;
}

/**
 * Get all valid share link paths for static generation
 */
export function getAllShareTokens(): string[] {
  return Object.keys(SHARE_LINK_CONFIG);
}
