/**
 * Javora — pulling structured credentials out of research-file prose.
 *
 * THE DANGER THIS MODULE IS BUILT AROUND
 *
 * The research files write about education in sentences, and a large share of
 * those sentences are NEGATIVE:
 *
 *   "No official confirmation of M.A. or other master's"
 *   "Secondary sources report a B.A. (Hons) ... but official confirmation is lacking"
 *   "Not listed. (No official record of degrees; ...)"
 *
 * A naive scan for award tokens turns the first sentence into a Master of Arts
 * on a real person's public record. The award appears in the text; it is the
 * surrounding negation that carries the meaning. So every match here must
 * survive a polarity check before it becomes a claim, and anything ambiguous
 * is dropped rather than guessed at — a missing credential is a gap, an
 * invented one is a falsehood about a named individual.
 *
 * WHAT COMES OUT
 *
 * Verbatim spans, not tidied values. `institution` and `field` are populated
 * only from unambiguous patterns; otherwise they stay null and the whole span
 * is preserved so a reviewer sees exactly what the file said.
 */

import { classifyEducationLevel, type EducationLevel } from "../../src/lib/parliamentDetail.ts";

export interface ExtractedCredential {
  /** Verbatim span from the prose, e.g. "B.Sc. (Eastern University)". */
  award: string;
  institution: string | null;
  field: string | null;
  level: EducationLevel;
  /** The sentence it came from, for review. */
  context: string;
}

/**
 * Award tokens as PROSE writes them. Longest-first within each family so
 * "Bachelor of Arts" wins over a bare "BA", and "PG Diploma" over "Diploma".
 */
const AWARD_TOKENS = [
  /\bDoctor of Philosophy\b/gi,
  /\bPh\.?\s?D\.?/gi,
  /\bBachelor of Arts\s*\((?:Hons?|Honours?)\)/gi,
  /\bBachelor of Arts\b/gi,
  /\bBachelor of Science\b/gi,
  /\bBachelor of Commerce\b/gi,
  /\bBachelor of Medicine\b/gi,
  /\bMaster of Science\b/gi,
  /\bMaster of Arts\b/gi,
  /\bB\.?\s?A\.?\s*\((?:Hons?|Honours?)\)/gi,
  /\bMBBS\b/gi,
  /\bMBA\b/gi,
  /\bLL\.?\s?[BM]\b/gi,
  /\bB\.?\s?Sc\b/gi,
  /\bM\.?\s?Sc\b/gi,
  /\bM\.?\s?Phil\b/gi,
  /\bPostgraduate Diploma\b/gi,
  /\bPG\s?Dip(?:loma)?\b/gi,
  /\bDiploma\b/gi,
  /\bAttorney[\s-]?at[\s-]?Law\b/gi,
  /\bBarrister[\s-]?at[\s-]?Law\b/gi,
];

/**
 * Words that flip the polarity of a nearby award mention.
 *
 * "aside from" and "rather than" are here because the files use them to
 * exclude: "No official confirmation of M.A. ... aside from the Ph.D. claim".
 */
const NEGATION =
  /\b(no|not|never|none|without|lacking|lacks|absent|unconfirmed|undocumented|aside from|rather than|instead of|cannot)\b/i;

/** Sentences that only point elsewhere carry no value of their own. */
const CROSS_REFERENCE = /\b(see above|as above|see below|per above)\b/i;

/**
 * Split prose into sentences.
 *
 * The hard part is that award abbreviations contain periods. Splitting on
 * "period + space + capital" tears "a Ph.D. (Philosophy), but confirmation is
 * lacking" in two, stranding the negation in a different sentence from the
 * award it negates — and a disclaimed doctorate silently becomes an asserted
 * one. So a split point is rejected when the period terminates a known
 * abbreviation or a single letter.
 */
const ABBREVIATION_BEFORE =
  /(?:^|[^A-Za-z])(?:Ph|LL|Sc|Ed|Com|Eng|Hons?|Dip|Prof|Dr|Mrs?|Ms|St|No|Rtd|approx|[A-Za-z])$/;

function sentences(prose: string): string[] {
  const out: string[] = [];
  let start = 0;
  const boundary = /([.!?])\s+(?=[A-Z(])/g;
  let m: RegExpExecArray | null;

  while ((m = boundary.exec(prose))) {
    const head = prose.slice(start, m.index + 1);
    // Text immediately before the period decides whether this is a real
    // sentence end or the middle of "Ph.D." / "B.A.".
    if (ABBREVIATION_BEFORE.test(prose.slice(Math.max(0, m.index - 12), m.index))) continue;
    const trimmed = head.trim();
    if (trimmed) out.push(trimmed);
    start = m.index + m[0].length;
  }
  const tail = prose.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Is this award mention affirmative?
 *
 * The check is deliberately blunt: any negation anywhere in the sentence
 * disqualifies every award in it. That drops some genuine credentials found
 * in mixed sentences ("Secondary sources report a B.A. (Hons) and a Ph.D. ...
 * but official confirmation is lacking"), which is the correct trade — such a
 * sentence is telling us the claim is unconfirmed, and dropping it costs a
 * gap while keeping it would cost a falsehood.
 */
function isAffirmative(sentence: string): boolean {
  return !NEGATION.test(sentence) && !CROSS_REFERENCE.test(sentence);
}

/** A trailing "(...)" immediately after an award, when it names a body. */
const INSTITUTION_HINT = /\b(University|College|Institute|School|Academy|Law College)\b/i;

function contextAfter(sentence: string, endIndex: number): string {
  // Up to the next clause boundary — enough to catch "(Eastern University)"
  // or "in Disaster Management at Peradeniya" without swallowing the sentence.
  // Skip the punctuation the award match left behind: "B.Sc" ends before
  // its own trailing period, and cutting at the first "." would then discard
  // the "(Eastern University)" that follows it.
  const tail = sentence.slice(endIndex, endIndex + 90).replace(/^[.,:\s]+/, "");
  const cut = /[.;]|\band\b|\bplus\b|,\s*(?=[A-Z])/.exec(tail);
  return (cut ? tail.slice(0, cut.index) : tail).trim();
}

export function extractCredentials(prose: string): ExtractedCredential[] {
  const out: ExtractedCredential[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences(prose)) {
    if (!isAffirmative(sentence)) continue;

    // Collect every candidate with its span first, then drop matches nested
    // inside a longer one. Without this, "PG Diploma in Education" yields both
    // "PG Diploma" and a second, bare "Diploma" — one credential recorded
    // twice, at two different levels.
    const hits: { award: string; start: number; end: number }[] = [];
    for (const token of AWARD_TOKENS) {
      token.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = token.exec(sentence))) {
        hits.push({ award: m[0].trim(), start: m.index, end: m.index + m[0].length });
      }
    }
    const kept = hits.filter((h, i) =>
      !hits.some((o, j) => j !== i && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
    kept.sort((a, b) => a.start - b.start);

    for (const hit of kept) {
      const award = hit.award.replace(/\.$/, "");
      const tail = contextAfter(sentence, hit.end);

      // A parenthetical right after the award: institution, or a field.
      const paren = /^\(([^)]+)\)/.exec(tail);
      const institution = paren && INSTITUTION_HINT.test(paren[1]!) ? paren[1]!.trim() : null;

      // "in <field>" / "of <field>" immediately following.
      const fieldM = /^(?:in|of)\s+([a-z][a-z\s&]{2,40})/i.exec(tail);
      const field = fieldM ? fieldM[1]!.trim().replace(/\s+$/, "") : null;

      const span = institution ? `${award} (${institution})` : award;
      const key = span.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ award: span, institution, field, level: classifyEducationLevel(award), context: sentence });
    }
  }
  return out;
}
