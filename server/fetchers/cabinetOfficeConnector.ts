/**
 * Javora — Cabinet Office of Sri Lanka: the current Cabinet of Ministers.
 *
 * WHY THIS SOURCE MATTERS SEPARATELY FROM PARLIAMENT
 *
 * Parliament's member directory publishes a single "Portfolio" string per
 * member, and it publishes nothing at all about people who are not members.
 * The Cabinet Office publishes the roster as the executive actually
 * constitutes it:
 *
 *   · Each minister's portfolios as SEPARATE lines, so a minister holding two
 *     ministries is two records rather than one comma-joined string.
 *   · The President, who heads the Cabinet and is not a Member of Parliament,
 *     and therefore appears in no parliamentary directory.
 *
 * Under Javora's fact-specific authority rules this source is authoritative
 * for portfolio assignment; Parliament remains authoritative for parliamentary
 * membership. Neither overrides the other outside its own competence.
 *
 * WHAT THIS PARSER REFUSES TO DO
 *
 * It does not resolve identity. It returns names exactly as the Cabinet Office
 * writes them ("Hon (Prof). Anil Jayantha Fernando", note the misplaced full
 * stop) and leaves matching to the identity layer, which can see every other
 * source. A parser that guessed at people would create a second Anil Jayantha.
 */

import { decodeEntities } from "../../src/lib/html.ts";

/* ==========================================================================
   Rows
   ========================================================================== */

export type CabinetRole = "president" | "prime-minister" | "cabinet-minister";

export interface CabinetMemberRow {
  /** Verbatim, including honorifics and the source's own punctuation. */
  rawName: string;
  /** Section the person appeared under. */
  role: CabinetRole;
  /** One entry per ministry. Never joined into a single string. */
  portfolios: string[];
}

export interface CabinetRoster {
  /** The source's own label for the roster, verbatim and uncorrected. */
  heading: string | null;
  members: CabinetMemberRow[];
}

/* ==========================================================================
   Parsing
   ========================================================================== */

/** Visible text lines, scripts and styles removed. */
export function textLines(html: string): string[] {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Section headings, which must NOT be read as portfolios.
 *
 * "President of the Democratic Socialist Republic of Sri Lanka" is the banner
 * above the President's entry, and "Prime Minister of the Democratic Socialist
 * Republic of Sri Lanka" the banner above the Prime Minister's. Both begin
 * exactly like a portfolio line. Treating them as portfolios attached the
 * Prime Minister's banner to the PRESIDENT — giving the head of state a Prime
 * Ministerial office he does not hold, from a heading that was never about him.
 */
const SECTION_HEADINGS: [RegExp, CabinetRole][] = [
  [/^President of the Democratic Socialist Republic/i, "president"],
  [/^Prime Minister of the Democratic Socialist Republic/i, "prime-minister"],
  [/^Other Cabinet Ministers$/i, "cabinet-minister"],
  [/^Cabinet of Ministers$/i, "cabinet-minister"],
];

/** A person line. The source writes "Hon.", "Hon (Prof).", "Hon. (Mrs.)" … */
const PERSON_LINE = /^Hon\b[\s.]*\(?/i;

/**
 * A portfolio line.
 *
 * Deliberately narrow: only "Minister of …" and the bare office titles
 * "President" / "Prime Minister" count. Anything else on the page — navigation,
 * captions, footers — is not an office and is ignored rather than guessed at.
 */
const PORTFOLIO_LINE =
  /^(Minister of\b.+|President and Head of the Cabinet of Ministers|Prime Minister)$/i;

export function parseCabinetRoster(html: string): CabinetRoster {
  const lines = textLines(html);
  const members: CabinetMemberRow[] = [];
  let heading: string | null = null;
  let section: CabinetRole = "cabinet-minister";
  let current: CabinetMemberRow | null = null;

  for (const line of lines) {
    if (!heading && /^Cabinet of the .+ Parliament/i.test(line)) heading = line;

    const sectionHit = SECTION_HEADINGS.find(([re]) => re.test(line));
    if (sectionHit) {
      section = sectionHit[1];
      // A heading closes the previous person; it is not their portfolio.
      current = null;
      continue;
    }

    if (PERSON_LINE.test(line)) {
      current = { rawName: line, role: section, portfolios: [] };
      members.push(current);
      continue;
    }

    if (current && PORTFOLIO_LINE.test(line)) current.portfolios.push(line);
  }

  return { heading, members };
}

/* ==========================================================================
   Normalisation helpers
   ========================================================================== */

/**
 * Strip the honorifics the Cabinet Office wraps around a name.
 *
 * Handles the source's own irregular punctuation — "Hon (Prof). Anil", "Hon.
 * (Dr). Nalinda" — and a trailing professional suffix, "Harshana Nanayakkara
 * (Attorney-at-law)". The suffix is a credential, not part of the name, and
 * leaving it attached prevents the person from matching their Parliament
 * record.
 */
export function canonicalCabinetName(rawName: string): string {
  let name = rawName.trim();
  // Leading "Hon" plus any bracketed titles, in any punctuation arrangement.
  name = name.replace(/^Hon\b[\s.]*/i, "");
  for (;;) {
    const next = name.replace(/^\(\s*(?:Dr|Prof|Mrs|Ms|Mr|Rev|Ven|Eng|Adm|Gen)\.?\s*\)\.?\s*/i, "");
    if (next === name) break;
    name = next;
  }
  // A trailing parenthetical credential.
  name = name.replace(/\s*\((?:attorney[\s-]?at[\s-]?law|president'?s counsel|pc)\)\s*$/i, "");
  return name.replace(/\s+/g, " ").trim();
}

/**
 * The office a portfolio line names, split from its ministry.
 *
 * "President and Head of the Cabinet of Ministers" is the office of President;
 * the rest of the phrase describes what that office entails and is not a
 * separate ministry.
 */
export function officeFromPortfolio(line: string): { title: string; ministry: string | null } {
  const trimmed = line.trim();
  if (/^President and Head of the Cabinet/i.test(trimmed)) {
    return { title: "President", ministry: null };
  }
  if (/^Prime Minister$/i.test(trimmed)) return { title: "Prime Minister", ministry: null };
  const m = /^Minister of\s+(.+)$/i.exec(trimmed);
  return m ? { title: trimmed, ministry: m[1]!.trim() } : { title: trimmed, ministry: null };
}
