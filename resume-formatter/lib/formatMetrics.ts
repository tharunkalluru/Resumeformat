/**
 * Automatically bold impactful metrics in text
 * 
 * ONLY bolds the number/metric itself - nothing after it
 */
export function boldMetrics(text: string): string {
  if (!text) return text;

  // User-pasted text is rendered with dangerouslySetInnerHTML so it must be
  // escaped before adding the small amount of markup we control.
  let result = escapeHtml(text);

  // Dollar amounts: $5K, $400K, $1.8M, ~$740K (ONLY the dollar amount)
  result = result.replace(/(\~?\$[\d.,]+[KMB]?\+?)/gi, '<strong>$1</strong>');
  
  // Percentages: +65%, 40%, ~99% (ONLY the percentage)
  result = result.replace(/([+\-~]?\d+(?:\.\d+)?%)/g, '<strong>$1</strong>');
  
  // Numbers with B/M/K suffix: 1.9B+, 17K, 400K+ (ONLY the number)
  // Use word boundary and negative lookahead to not capture trailing text
  result = result.replace(/\b(\d+(?:\.\d+)?[BMK]\+?)\b(?![a-zA-Z])/gi, '<strong>$1</strong>');
  
  // Numbers followed by + (like 60+, 10+, 20+) - ONLY the number with plus
  result = result.replace(/\b(\d+\+)\b/g, '<strong>$1</strong>');
  
  // Tilde numbers: ~3, ~99 (but not if already caught by percentage)
  result = result.replace(/(\~\d+)(?![%\d])/g, '<strong>$1</strong>');

  return result;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Strip HTML tags for plain text operations
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}
