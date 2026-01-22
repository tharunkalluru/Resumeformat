/**
 * Automatically bold impactful metrics in text
 * 
 * ONLY bolds the number/metric itself - nothing after it
 */
export function boldMetrics(text: string): string {
  if (!text) return text;
  
  // Don't process if already contains HTML bold tags
  if (/<\/?(?:strong|b)>/i.test(text)) {
    return text;
  }

  let result = text;

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

/**
 * Strip HTML tags for plain text operations
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}
