/**
 * Javora — Parliament of Sri Lanka member profile: the "Related Information"
 * panes.
 *
 * WHY THIS FILE EXISTS
 *
 * The original connector read the eleven labelled fields at the top of a
 * member's profile page and concluded that Parliament publishes no education
 * data. That conclusion was wrong, and it was wrong for a mundane reason: the
 * rest of the record lives in Bootstrap tab panes further down the same HTML
 * document, under a "Related Information" heading. They are not fetched
 * separately and they are not rendered by script — they are already in the
 * bytes the connector was downloading and discarding.
 *
 * Those panes publish, for every sitting member:
 *
 *   Qualifications        academic and "professional" credentials
 *   Legislative History   every parliament served in, with PER-MEMBER dates
 *   Portfolios Held       offices, grouped by parliament, with start dates
 *   Ministerial Services  ministerial offices with start AND end dates
 *
 * This is Tier 1 evidence — the institution stating its own members' records —
 * and it is strictly better than any secondary biography. Legislative History
 * in particular removes the platform's largest gap: real position start dates.
 * The dates are per-member, not per-parliament (two members of the same
 * parliament carry different start dates), so they record actual service.
 *
 * PARSING, NOT TRUSTING
 *
 * Every function here is pure and returns the source's own vocabulary
 * verbatim. Nothing is normalised, corrected, expanded or inferred. Where the
 * source is ambiguous the ambiguity is preserved and reported rather than
 * resolved by guesswork — see `classifyEducationLevel` and
 * `looksLikeCredential`, both of which report "unknown" instead of picking.
 *
 * A NOTE ON ATTRIBUTE QUOTING. parliament.lk emits single-quoted HTML
 * attributes. A double-quote-only regex silently matches nothing here, which
 * is a failure mode that looks exactly like "the source publishes nothing".
 * Every pattern below accepts either quote style.
 */

import {
  isAbsentMarker, isBoilerplate,
  type ParliamentTermRow, type PortfolioRow, type MinisterialServiceRow,
  type QualificationRows, type ProfileDetail, type PoliticalCareerEntry,
} from "../../src/lib/parliamentDetail.ts";

export type {
  ParliamentTermRow, PortfolioRow, MinisterialServiceRow,
  QualificationRows, ProfileDetail, PoliticalCareerEntry,
};
export { isAbsentMarker, isBoilerplate };
export { classifyEducationLevel, looksLikeCredential } from "../../src/lib/parliamentDetail.ts";

/* ==========================================================================
   HTML helpers
   ========================================================================== */

/**
 * Decode HTML entities.
 *
 * This must be exhaustive enough for the source, because entries are split on
 * semicolons further down and an entity reference IS a semicolon-terminated
 * token. An undecoded `&ndash;` does not merely render badly — it splits into
 * "Member &ndash" and an empty fragment, turning one credential into two
 * corrupted ones. Named entities are decoded first, then any remaining
 * numeric references.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", hellip: "…", bull: "•",
  middot: "·", deg: "°", eacute: "é", uuml: "ü",
  // Zero-width joiners appear inside Sinhala text on this source. They carry
  // no visible content but DO carry a semicolon, so leaving them undecoded
  // splits a qualification in half.
  zwj: "‍", zwnj: "‌", shy: "",
};

/**
 * Repair text the source stored as UTF-8 bytes read back as Latin-1.
 *
 * Some Sinhala and Tamil qualification entries arrive as "à¶»à·“ à¶½à¶‚à¶šà·".
 * That is not a decoding mistake on this end — `Response.text()` decodes UTF-8
 * — it is double-encoded at the source.
 *
 * The repair is guarded rather than blanket: it is applied only when
 * reinterpreting the bytes actually produces Sinhala or Tamil codepoints.
 * Applied unconditionally it would mangle legitimately accented Latin text
 * (a French institution name, say), so a repair that does not yield the
 * script it claims to recover is discarded.
 */
export function repairMojibake(text: string): string {
  if (!/[ÃÂà¶à·â]/.test(text)) return text;
  let repaired: string;
  try {
    repaired = Buffer.from(text, "latin1").toString("utf8");
  } catch {
    return text;
  }
  const gainedIndic = /[඀-෿஀-௿]/.test(repaired);
  return gainedIndic && !repaired.includes("�") ? repaired : text;
}

/**
 * Split a qualifications entry on semicolons that actually separate entries.
 *
 * A semicolon inside parentheses does not: this source writes
 * "Fellow Chartered Accountant (the Institute of Chartered Accountants of
 * Sri Lanka); Fellow CMA member (...)", and a naive split on every semicolon
 * tears one credential's parenthetical away from it and fuses the fragments
 * with the next credential.
 */
/**
 * Bullet glyphs this source uses to separate entries INSIDE a single list
 * item, in place of semicolons.
 *
 * U+F0A7 is the Wingdings square bullet, pasted in from a word processor. It
 * also arrives double-encoded, as the three characters "ï‚§". Both forms are
 * separators, and a member whose qualifications are bulleted rather than
 * semicolon-separated otherwise gets five degrees fused into one unreadable
 * string beginning with a stray glyph.
 */
const BULLET_SEPARATORS = /[•▪●·]|ï‚§/g;

export function splitEntries(text: string): string[] {
  // Bullets split FIRST and unconditionally, before any parenthesis tracking.
  //
  // They cannot be folded into the paren-aware pass, because the source's own
  // parentheses are not always balanced: one member's qualifications contain
  // "Master of Business Administration (International Business, (Asian
  // Insitute of Technology, Bangkok Thailand)" — two opens, one close. A
  // depth counter never returns to zero after that, so every later bullet is
  // treated as "inside parentheses" and five degrees collapse into two.
  //
  // A bullet is an unambiguous separator whatever the depth says, so it is
  // trusted over the bracket state rather than subordinated to it.
  return text
    .split(BULLET_SEPARATORS)
    .flatMap((chunk) => splitOnTopLevelSemicolons(chunk));
}

/** Semicolon splitting that respects (balanced) parentheses. */
function splitOnTopLevelSemicolons(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (whole, name: string) =>
      NAMED_ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/&#x([0-9a-fA-F]+);/g, (_w, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_w, dec: string) => String.fromCodePoint(Number(dec)));
}

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]*>/g, " "));

/** Collapse the source's generous whitespace; null for nothing left. */
function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Slice out one tab pane by id.
 *
 * The same id prefix appears twice per pane — once on the nav button
 * (`v-pills-qualifications-tab`) and once on the pane itself. Matching the
 * button would return navigation chrome, so the pane is identified by
 * requiring `tab-pane` in the same opening tag. The pane ends where the next
 * pane begins.
 */
export function extractPane(html: string, paneId: string): string | null {
  const paneStarts: { id: string; index: number }[] = [];
  const re = /<div\s+id=['"](v-pills-[a-z_]+)['"][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (/tab-pane/i.test(m[0]!)) paneStarts.push({ id: m[1]!, index: m.index });
  }
  const at = paneStarts.findIndex((p) => p.id === paneId);
  if (at < 0) return null;
  const end = at + 1 < paneStarts.length ? paneStarts[at + 1]!.index : html.length;

  // Strip scripts and styles from the pane before anything reads it.
  //
  // Tag-stripping removes the <script> tags but keeps their CONTENTS, and this
  // source embeds client-side templates inside its panes. Without this, a
  // member's political career picked up a list item reading literally
  // "${item}" — the source's own unrendered placeholder, published on a real
  // person's profile as though it were a fact about their career.
  return html
    .slice(paneStarts[at]!.index, end)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
}

/**
 * Text that is markup machinery rather than content.
 *
 * Template placeholders survive tag-stripping because they are ordinary text
 * to an HTML parser. They are not statements about anybody.
 */
export function isTemplateArtifact(value: string): boolean {
  return /\$\{[^}]*\}|\{\{[^}]*\}\}|^<%[\s\S]*%>$/.test(value.trim());
}

/**
 * Top-level `<li>` texts in a fragment, skipping the `<b>`-wrapped headings
 * the source uses as group labels.
 */
function listItems(fragment: string): string[] {
  const items: string[] = [];
  for (const m of fragment.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const inner = m[1]!;
    if (/<b\b/i.test(inner)) continue; // a group heading, not an entry
    const text = clean(stripTags(inner));
    if (text && !isTemplateArtifact(text)) items.push(text);
  }
  return items;
}

/** The chunk following a `<b>Heading</b>` up to the next `<b>` or the end. */
function sectionAfterHeading(fragment: string, heading: string): string | null {
  const re = new RegExp(`<b\\b[^>]*>\\s*${heading}\\s*</b>`, "i");
  const hit = re.exec(fragment);
  if (!hit) return null;
  const rest = fragment.slice(hit.index + hit[0].length);
  const next = /<b\b[^>]*>/i.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * Parse the source's date parenthetical.
 *
 *   "(2024-11-15 - to date)"    → start, ongoing
 *   "(2020-08-14 - 2024-09-24)" → start and end
 *   "(2024-11-18)"              → start only
 *
 * Returns the title with the parenthetical removed, so the office title stays
 * verbatim minus the dates. A trailing parenthetical that is NOT a date is
 * left attached to the title — it is part of what the source called the office.
 */
export function splitTrailingDates(text: string): {
  title: string;
  startDate: string | null;
  endDate: string | null;
  ongoing: boolean;
} {
  // The trailing end is optional AFTER the dash as well as instead of it: the
  // source emits "(2009-07-02 - )" with an empty end. Requiring a value there
  // makes the whole pattern fail, which leaves the dates stranded inside the
  // office title and produces a position with no temporal information at all —
  // and a position with no end date reads as still held.
  const re = /\s*\((\d{4}-\d{2}-\d{2})(?:\s*[-–]\s*(to date|\d{4}-\d{2}-\d{2})?)?\)\s*$/i;
  const m = re.exec(text);
  if (!m) {
    // An EMPTY date parenthetical, which this source does publish: one record
    // reads "Deputy Minister of Irrigation, Power & Highways ( - )" and
    // another leaves the bracket unclosed. The brackets are a date field the
    // source never filled in, not part of the office name, so they are
    // dropped — and no date is inferred from them. The position stays
    // genuinely undated, which is what the source actually says.
    return {
      title: text.replace(/\s*\(\s*[-–—]?\s*\)?\s*$/, "").trim(),
      startDate: null, endDate: null, ongoing: false,
    };
  }
  const tail = m[2] ?? null;
  const ongoing = tail != null && /to date/i.test(tail);
  return {
    title: text.slice(0, m.index).trim(),
    startDate: m[1]!,
    endDate: ongoing ? null : tail,
    ongoing,
  };
}

/* ==========================================================================
   Pane parsers
   ========================================================================== */

/**
 * Qualifications.
 *
 * The source packs several credentials into one `<li>` separated by
 * semicolons ("MBBS; MSc Project Management (Cardiff, UK); CHRM"), so entries
 * are split on semicolons as well as list items. Trailing semicolons — which
 * the source leaves on most entries — are dropped.
 */
export function parseQualifications(html: string): QualificationRows {
  const pane = extractPane(html, "v-pills-qualifications");
  if (!pane) return { academic: [], professional: [] };

  const collect = (heading: string): string[] => {
    const section = sectionAfterHeading(pane, heading);
    if (!section) return [];
    return listItems(section)
      .flatMap((item) => splitEntries(item))
      .map((part) => clean(repairMojibake(part ?? "")))
      .filter((part): part is string =>
        part !== null && !isAbsentMarker(part) && !isBoilerplate(part));
  };

  return {
    academic: collect("Academic Qualifications"),
    professional: collect("Professional Qualifications"),
  };
}

export function parseLegislativeHistory(html: string): ParliamentTermRow[] {
  const pane = extractPane(html, "v-pills-legislative_history");
  if (!pane) return [];
  return listItems(pane).map((item) => {
    const { title, startDate, endDate, ongoing } = splitTrailingDates(item);
    return { parliament: title, startDate, endDate, ongoing };
  });
}

/**
 * Portfolios Held, grouped under a `<b>`-headed parliament name.
 *
 * The grouping is the only place the source ties an office to a specific
 * parliament, so it is preserved rather than flattened.
 */
export function parsePortfoliosHeld(html: string): PortfolioRow[] {
  const pane = extractPane(html, "v-pills-roles");
  if (!pane) return [];

  const rows: PortfolioRow[] = [];
  // Each group is a <b>parliament</b> heading followed by that group's items.
  const headings = [...pane.matchAll(/<li\b[^>]*>\s*<b\b[^>]*>([\s\S]*?)<\/b>\s*<\/li>/gi)];
  for (let i = 0; i < headings.length; i++) {
    const parliament = clean(stripTags(headings[i]![1]!));
    if (!parliament) continue;
    const from = headings[i]!.index + headings[i]![0].length;
    const to = i + 1 < headings.length ? headings[i + 1]!.index : pane.length;
    for (const item of listItems(pane.slice(from, to))) {
      const { title, startDate } = splitTrailingDates(item);
      if (title) rows.push({ parliament, title, startDate });
    }
  }
  return rows;
}

export function parseMinisterialServices(html: string): MinisterialServiceRow[] {
  const pane = extractPane(html, "v-pills-services");
  if (!pane) return [];
  return listItems(pane)
    .map((item) => {
      const { title, startDate, endDate, ongoing } = splitTrailingDates(item);
      return { title, startDate, endDate, ongoing };
    })
    .filter((row) => Boolean(row.title));
}

/**
 * The "Political Career" pane, which only PAST members' profiles carry.
 *
 * It is a hand-written narrative list rather than a structured record:
 *
 *   "1959 - Entered into Politics and Contested for Maligawatta Ward (C.M.C.)"
 *   "1973 - Elected as the 16th Mayor of Colombo"
 *
 * Entries are kept VERBATIM and a year is attached only when the line itself
 * opens with one. The source also emits fragments — a bare " 1962 and 1965"
 * followed by a separate " Contested for Colombo Municipal Council Elections"
 * — and those are preserved as their own undated entries rather than being
 * stitched together into a sentence nobody published.
 *
 * Nothing here becomes a Position. A line reading "Elected Deputy Mayor of
 * Colombo" is evidence that an event was described, not a dated office record
 * with a start and an end, and promoting prose to an office would invent the
 * structure this platform exists to keep honest.
 */
export function parsePoliticalCareer(html: string): PoliticalCareerEntry[] {
  const pane = extractPane(html, "v-pills-political");
  if (!pane) return [];

  return listItems(pane).map((raw) => {
    // "1973 - Elected as ..." / "1973 – Elected ..." / "1973- Elected"
    const m = /^(1[89]\d{2}|20\d{2})\s*[-–—]\s*(.+)$/.exec(raw);
    if (m) return { year: m[1]!, text: m[2]!.trim(), verbatim: raw };
    // A line that is only a year, or a year range, with no description.
    const bare = /^(1[89]\d{2}|20\d{2})\b/.exec(raw);
    return { year: bare ? bare[1]! : null, text: raw, verbatim: raw };
  });
}

/** Read every "Related Information" pane from one profile page. */
export function parseProfileDetail(html: string): ProfileDetail {
  return {
    qualifications: parseQualifications(html),
    legislativeHistory: parseLegislativeHistory(html),
    portfoliosHeld: parsePortfoliosHeld(html),
    ministerialServices: parseMinisterialServices(html),
    politicalCareer: parsePoliticalCareer(html),
  };
}

