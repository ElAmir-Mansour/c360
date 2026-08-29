/**
 * email-suggest — pure, dependency-free email domain typo detection.
 *
 * Detects common mistypes of popular email domains (e.g. "gmial.com" ->
 * "gmail.com", "hotmial.com" -> "hotmail.com") and common TLD slips
 * (e.g. "gmail.con" -> "gmail.com"). Returns a corrected email address
 * string when a confident suggestion exists, otherwise `null`.
 *
 * This module is intentionally self-contained (no external deps) so it is
 * trivially unit-testable and safe to import on either the client or server.
 */

/** Curated list of the most common consumer/email-provider domains. */
const POPULAR_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'qq.com',
];

/** Curated list of common top-level domains. */
const POPULAR_TLDS: readonly string[] = [
  'com',
  'net',
  'org',
  'co.uk',
  'edu',
  'gov',
  'io',
  'co',
  'info',
  'me',
  'biz',
  'sa', // Saudi ccTLD — relevant to Clario360 tenants
  'com.sa',
];

/**
 * Iterative Levenshtein edit distance between two strings.
 * O(a.length * b.length) time, O(b.length) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = new Array(b.length + 1);
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Split an email into local part and domain. Returns null if not splittable. */
function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain.indexOf('@') !== -1) return null;
  return { local, domain };
}

/**
 * Find the closest candidate within a maximum edit distance.
 * Returns the candidate and its distance, or null when nothing is close enough.
 */
function closest(
  value: string,
  candidates: readonly string[],
  maxDistance: number,
): { match: string; distance: number } | null {
  let best: string | null = null;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    if (candidate === value) return null; // exact match → nothing to suggest
    const distance = levenshtein(value, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (best === null || bestDistance > maxDistance) return null;
  return { match: best, distance: bestDistance };
}

/**
 * Suggest a corrected email address if the domain looks like a typo of a
 * well-known domain, or if the TLD looks like a typo of a common TLD.
 *
 * @returns the corrected, lowercased email, or `null` when no confident
 *          correction is found (including when the input is already valid).
 */
export function suggestEmail(email: string): string | null {
  if (typeof email !== 'string') return null;

  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  const parts = splitEmail(trimmed);
  if (!parts) return null;
  const { local, domain } = parts;

  // Domain must contain a dot to be a plausible FQDN.
  if (domain.indexOf('.') === -1) return null;

  // Already a known-good domain → no suggestion.
  if (POPULAR_DOMAINS.includes(domain)) return null;

  // 1) Whole-domain typo against the curated domain list.
  //    Short domains tolerate fewer edits to avoid false positives.
  const domainMaxDistance = domain.length <= 6 ? 1 : 2;
  const domainMatch = closest(domain, POPULAR_DOMAINS, domainMaxDistance);
  if (domainMatch) {
    return `${local}@${domainMatch.match}`;
  }

  // 2) TLD-only slip (e.g. "gmail.con", "company.ogr).
  //    Keep the second-level label, correct just the TLD.
  const firstDot = domain.indexOf('.');
  const sld = domain.slice(0, firstDot);
  const tld = domain.slice(firstDot + 1);
  if (sld.length > 0 && tld.length > 0 && !POPULAR_TLDS.includes(tld)) {
    // Allow distance 2 only for same-length TLDs (catches transpositions such
    // as "ogr" -> "org"); otherwise require a single edit to avoid collisions
    // between short TLDs (e.g. "com" vs "co").
    const tldMatch = closest(tld, POPULAR_TLDS, 2);
    if (
      tldMatch &&
      (tldMatch.distance <= 1 || tldMatch.match.length === tld.length)
    ) {
      return `${local}@${sld}.${tldMatch.match}`;
    }
  }

  return null;
}

export const __testing = {
  POPULAR_DOMAINS,
  POPULAR_TLDS,
};
