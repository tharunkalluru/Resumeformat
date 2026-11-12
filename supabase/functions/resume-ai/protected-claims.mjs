// Conservative literal comparison, not arithmetic, approximation or entailment.
// Preserve units so a fact about 10 projects cannot authorize a claim of 10%.
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?`;
const NUMBER = String.raw`(?:\d+(?:[.,]\d+)*|\.\d+)`;
const DURATION = String.raw`(?:centur(?:y|ies)|decades?|years?|yrs?|months?|mos?|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)`;
const CARDINAL = String.raw`(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|half|a|an)`;
const UNIT = String.raw`(?:percentage\s+points?|per\s+cent|percent|${DURATION}|thousand|million|billion|dollars?|euros?|pounds?|USD|EUR|GBP|INR|JPY|CAD|AUD|k|m|b)\b`;
const DATE = String.raw`${MONTH}\s+\d{1,4}(?:st|nd|rd|th)?(?:(?:\s*,\s*|\s+)\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}(?:\s+\d{4})?`;
const QUANTITY = String.raw`(?:\p{Sc}\s*|(?:USD|EUR|GBP|INR|JPY|CAD|AUD)\s*)?[+\-−]?${NUMBER}(?:\s*[-–—/]\s*${NUMBER}(?:[-/]\d+)?)?(?:st|nd|rd|th)?\+?(?:\s*(?:-\s*)?${UNIT}|\s*[%×]|\s*x\b)?`;
const SPELLED_DURATION = String.raw`${CARDINAL}(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?(?:\s+(?:hundred|thousand))?(?:\s+|\s*-\s*)${DURATION}\b`;
const NUMERIC_EXPRESSIONS = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${DATE}|${QUANTITY}|${SPELLED_DURATION})(?![\p{L}\p{N}_])`, 'giu');

export function numericExpressions(text) {
  return [...text.matchAll(NUMERIC_EXPRESSIONS)].map(match => match[0].toLowerCase().replace(/\s+/gu, ' ').trim());
}

export function hasUnsupportedNumericClaims(text, citedFacts) {
  const supported = new Set(citedFacts.flatMap(fact => numericExpressions(fact.text)));
  return numericExpressions(text).some(expression => !supported.has(expression));
}
