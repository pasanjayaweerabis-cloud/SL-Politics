/**
 * Javora — research-file ingestion (staging layer).
 *
 * WHAT THESE FILES ARE
 *
 * Two documents supplied as research inputs: one produced by ChatGPT, one by
 * Gemini. They are compilations ABOUT sources, not sources. Under Javora's own
 * hierarchy they are Tier 3/Tier 4 material, and nothing in them is treated as
 * established merely because it is written down confidently.
 *
 * Three properties of the files drive this parser's design:
 *
 *  1. They disagree with themselves. The ChatGPT file says Adaikkalanathan has
 *     served "since 1994", then "from 2000", then dates his entry to 2000 in
 *     the same record. A parser that took the first match would launder one of
 *     three incompatible claims into a fact.
 *
 *  2. Their citations are mostly unresolvable. The ChatGPT file states
 *     "Citations included: YES" and contains no URLs at all. The Gemini file
 *     attributes vote counts to "Election Commission of Sri Lanka / Ada
 *     Derana" while linking only Ada Derana — a news aggregator. What a file
 *     NAMES as its source and what it actually EVIDENCES are different things,
 *     so both are recorded separately and the tier is derived from the link.
 *
 *  3. They self-report their own confidence ("Secondary Corroborated", "NOT
 *     PUBLICLY VERIFIED"). Those labels are preserved verbatim and never
 *     upgraded.
 *
 * WHAT THIS MODULE DOES AND DOES NOT DO
 *
 * It parses. It does not decide. Every claim it emits carries the file, the
 * line number and the verbatim source text it came from, so a reviewer can
 * check any staged row against the original in one step. Matching to people,
 * comparison against canonical data, and the decision to promote anything at
 * all happen downstream in `reconcileResearch.ts`.
 */

/* ==========================================================================
   Claim shape
   ========================================================================== */

export type ResearchField =
  | "school" | "university" | "postgraduate" | "certification"
  | "ol" | "al"
  | "employment" | "public-service"
  | "current-position" | "historical-position"
  | "party-history" | "election" | "timeline"
  | "legal-challenge"
  | "date-of-birth" | "place-of-birth" | "profession";

/**
 * Source tiers, as the user's hierarchy defines them. Derived from what a
 * claim actually cites, never from how confident the sentence sounds.
 */
export type SourceTier = 1 | 2 | 3 | 4;

export interface ResearchClaim {
  /** Person name exactly as the research file writes it. */
  subjectName: string;
  field: ResearchField;
  /** The claim's payload, verbatim from the file. */
  value: string;
  /** What the file SAYS supports this. */
  citedSource: string | null;
  /** A URL the file actually provides, if any. */
  sourceUrl: string | null;
  tier: SourceTier;
  /** The file's own confidence label, preserved unchanged. */
  selfReportedStatus: string | null;
  /** Provenance, so any staged row can be checked against the original. */
  file: string;
  line: number;
  rawText: string;
}

/* ==========================================================================
   Source tiering
   ========================================================================== */

/**
 * Map a cited-source string to a tier.
 *
 * Deliberately strict. "Election Commission of Sri Lanka / Ada Derana" cites
 * an authority and a newspaper together; the strongest thing actually
 * evidenced is the newspaper, so the pair resolves to Tier 3. Crediting it as
 * Tier 1 would let a news report acquire the standing of an official return.
 */
const TIER_1 = [
  /parliament of sri lanka/i, /parliament\.lk/i,
  /cabinet office/i, /cabinetoffice\.gov\.lk/i,
  /presidential secretariat/i,
  /government gazette/i, /gazette extraordinary/i, /documents\.gov\.lk/i,
  /ministry of [a-z ]+/i, /\.gov\.lk/i,
];
const TIER_3 = [
  /manthri/i, /verit[eé]/i, /ada ?derana/i, /daily mirror/i, /daily news/i,
  /the island/i, /newsfirst/i, /economynext/i, /sunday times/i,
  /council of women world leaders/i, /tobacco unmasked/i, /election monitor/i,
  /court filings/i, /press/i, /news/i,
];
const TIER_4 = [/wikipedia/i, /secondary corroborated/i, /by inference/i];

export function tierFor(citedSource: string | null, sourceUrl: string | null): SourceTier {
  const text = `${citedSource ?? ""} ${sourceUrl ?? ""}`;
  // A bare Election Commission citation with no document is not the return
  // itself; it is an assertion that the return says something.
  if (TIER_4.some((re) => re.test(text))) {
    // A Tier 4 marker alongside a real official URL is still only as good as
    // the weaker of the two.
    return 4;
  }
  if (TIER_3.some((re) => re.test(text))) return 3;
  if (TIER_1.some((re) => re.test(text))) return 1;
  if (/election commission/i.test(text)) return 2;
  return 4;
}

/* ==========================================================================
   Shared helpers
   ========================================================================== */

/**
 * The many ways these files write "we found nothing".
 *
 * Matching only exact phrases is not enough: the files qualify their absences
 * ("Not documented publicly.", "Not publicly documented.", "None found in
 * official sources."). An unmatched absence statement gets stored as though
 * it were a value, which is how the literal string "Not documented" ends up
 * displayed as somebody's school.
 */
const ABSENCE_HEAD =
  /^(?:not|no|none|nothing)\b[\s\S]{0,40}?\b(?:verified|documented|found|provided|listed|available|recorded|applicable|reported|given|known|data|details?|information)\b/i;

export function isNotVerified(value: string): boolean {
  const v = value.trim().replace(/\.$/, "");
  if (!v) return true;
  if (/^(n\/?a|none|nil|unknown|-+|—)$/i.test(v)) return true;
  // Only treat it as an absence when the WHOLE value is the statement — a
  // long paragraph that merely opens with "No school data" may still carry a
  // real claim later in the sentence.
  return ABSENCE_HEAD.test(v) && v.length <= 80;
}

const URL_RE = /https?:\/\/[^\s)\]",]+/;

const firstUrl = (text: string): string | null => URL_RE.exec(text)?.[0] ?? null;

/** Strip markdown emphasis and collapse whitespace. */
function plain(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

/* ==========================================================================
   ChatGPT file — "# Name" headings with "**Field:** value" paragraphs
   ========================================================================== */

/** Heading → the canonical field a paragraph populates. */
const CHATGPT_FIELDS: [RegExp, ResearchField][] = [
  [/^Education$/i, "school"],
  [/^O\/L$/i, "ol"],
  [/^A\/L$/i, "al"],
  [/^University\/Degrees$/i, "university"],
  [/^Postgraduate$/i, "postgraduate"],
  [/^Certifications$/i, "certification"],
  [/^Professional Experience$/i, "employment"],
  [/^Public\/Institutional Service$/i, "public-service"],
  [/^Current Political Positions$/i, "current-position"],
  [/^Current Portfolios$/i, "current-position"],
  [/^Political Career History$/i, "historical-position"],
  [/^Parliamentary History$/i, "historical-position"],
  [/^Party History$/i, "party-history"],
  [/^Election History$/i, "election"],
  [/^Timeline$/i, "timeline"],
];

export function parseChatGptResearch(text: string, fileName: string): ResearchClaim[] {
  const claims: ResearchClaim[] = [];
  const lines = text.split(/\r?\n/);

  let subject: string | null = null;
  // The "Sources:" paragraph sits at the END of a person's block, so claims
  // are buffered and stamped with it once the block closes.
  let pending: Omit<ResearchClaim, "citedSource" | "tier">[] = [];
  let sources: string | null = null;

  const flush = (): void => {
    for (const c of pending) {
      claims.push({ ...c, citedSource: sources, tier: tierFor(sources, c.sourceUrl) });
    }
    pending = [];
    sources = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^#\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const name = heading[1]!.trim();
      subject = /coverage summary/i.test(name) ? null : name;
      continue;
    }
    if (!subject) continue;

    const field = /^\*\*(.+?):\*\*\s*(.*)$/.exec(line);
    if (!field) continue;

    const label = field[1]!.trim();
    const body = plain(field[2]!);

    if (/^Sources$/i.test(label)) { sources = body || null; continue; }
    if (!body || isNotVerified(body)) continue;

    // "O/L/A/L:" is one combined heading in some records.
    const targets: ResearchField[] = /^O\/L\/A\/L$/i.test(label)
      ? ["ol", "al"]
      : CHATGPT_FIELDS.filter(([re]) => re.test(label)).map(([, f]) => f);

    for (const target of targets) {
      pending.push({
        subjectName: subject,
        field: target,
        value: body,
        sourceUrl: firstUrl(body),
        selfReportedStatus: null,
        file: fileName,
        line: i + 1,
        rawText: line.trim(),
      });
    }
  }
  flush();
  return claims;
}

/* ==========================================================================
   Gemini file — "PERSON #n" blocks of "Key: Value" lines
   ========================================================================== */

/**
 * Section markers. The file glues these onto the end of the preceding value
 * ("Tamil Name: NOT PUBLICLY VERIFIEDIDENTITY"), so they must be recognised
 * as suffixes and stripped, not just matched at line starts.
 */
const GEMINI_SECTIONS = [
  "NAME", "IDENTITY", "PORTRAIT", "EDUCATION", "PROFESSIONAL EXPERIENCE",
  "PUBLIC / INSTITUTIONAL SERVICE", "CURRENT POLITICAL POSITIONS",
  "POLITICAL CAREER HISTORY", "POLITICAL PARTY HISTORY", "PARLIAMENTARY HISTORY",
  "ELECTION HISTORY", "TIMELINE", "DATA QUALITY", "SOURCES",
];

/**
 * The key that OPENS a new entity within each section.
 *
 * The files list one entity as a run of "Key: Value" lines with no blank line
 * or delimiter between entities, so the only reliable boundary is the
 * reappearance of the section's leading key.
 */
const ENTITY_STARTERS: Record<string, string[]> = {
  EDUCATION: ["School", "O/L", "A/L", "University", "Postgraduate", "Certifications"],
  "PROFESSIONAL EXPERIENCE": ["Organization"],
  "PUBLIC / INSTITUTIONAL SERVICE": ["Organization"],
  "CURRENT POLITICAL POSITIONS": ["Position"],
  "POLITICAL CAREER HISTORY": ["Position"],
  "POLITICAL PARTY HISTORY": ["Party"],
  "PARLIAMENTARY HISTORY": ["Parliament"],
  "ELECTION HISTORY": ["Election"],
  TIMELINE: ["Date"],
};

const isStarterKey = (starters: string[] | undefined, key: string): boolean =>
  Boolean(starters?.some((s) => key.toLowerCase().startsWith(s.toLowerCase())));

/**
 * Split a line where the next entity's key is glued to the previous value.
 *
 * The files run entities together with no separator:
 *
 *   "Status: SECONDARY-CORROBORATEDOrganization: Nest Sri Lanka"
 *
 * Left joined, the fields of two different entities land in one record and
 * the resulting row is a composite of both — in the case that prompted this
 * function, one employer's name attached to a different employer's job title
 * and a third date range. That is not a parsing inconvenience, it is a
 * fabricated employment record about a real person.
 *
 * Splitting keys on the LITERAL starter names, rather than on a
 * capitalisation heuristic, is what makes this reliable: the preceding value
 * may itself be upper-case, lower-case or punctuation, and any rule based on
 * the character before the boundary gets one of those cases wrong.
 */
export function ungluedEntities(text: string, starters: string[] | undefined): string[] {
  if (!starters?.length) return [text];
  const pieces: string[] = [];
  let rest = text;

  for (;;) {
    let cut = -1;
    for (const name of starters) {
      // Look only past the first character: a starter at index 0 opens THIS
      // piece rather than the next one.
      let from = 1;
      for (;;) {
        const at = rest.indexOf(`${name}:`, from);
        if (at < 0) break;
        // A key preceded by whitespace was already its own token.
        if (!/\s/.test(rest[at - 1] ?? " ")) { if (cut < 0 || at < cut) cut = at; break; }
        from = at + 1;
      }
    }
    if (cut < 0) break;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  pieces.push(rest);
  return pieces.map((p) => p.trim()).filter(Boolean);
}

/** EDUCATION is the one section whose field comes from the entity's key. */
function educationFieldFor(key: string): ResearchField | null {
  if (/^School/i.test(key)) return "school";
  if (/^O\/L/i.test(key)) return "ol";
  if (/^A\/L/i.test(key)) return "al";
  if (/^University/i.test(key)) return "university";
  if (/^Postgraduate/i.test(key)) return "postgraduate";
  if (/^Certifications/i.test(key)) return "certification";
  return null;
}

const SECTION_FIELD: Record<string, ResearchField | null> = {
  "PROFESSIONAL EXPERIENCE": "employment",
  "PUBLIC / INSTITUTIONAL SERVICE": "public-service",
  "CURRENT POLITICAL POSITIONS": "current-position",
  "POLITICAL CAREER HISTORY": "historical-position",
  "POLITICAL PARTY HISTORY": "party-history",
  "PARLIAMENTARY HISTORY": "historical-position",
  "ELECTION HISTORY": "election",
  "TIMELINE": "timeline",
};

/**
 * Split a Gemini person block into (section, lines) pairs.
 *
 * Section markers are matched CASE-SENSITIVELY, which is what makes this
 * tractable: the file writes headings in caps ("EDUCATION") and ordinary
 * values in title case ("Minister of Education"), so case alone separates a
 * heading from a value that happens to contain the same word.
 *
 * At each step the EARLIEST marker wins, and among markers starting at the
 * same offset the LONGEST wins, so "PUBLIC / INSTITUTIONAL SERVICE" is not
 * truncated. An earlier version also demanded that the character before a
 * marker be lowercase; because the file glues headings onto the end of
 * ALL-CAPS values ("...NOT PUBLICLY VERIFIEDELECTION HISTORY"), that test
 * rejected exactly the cases the function exists to handle.
 */
export function splitGeminiSections(block: string): { section: string; lines: { text: string; line: number }[] }[] {
  const out: { section: string; lines: { text: string; line: number }[] }[] = [];
  let current = { section: "NAME", lines: [] as { text: string; line: number }[] };

  block.split(/\r?\n/).forEach((raw, idx) => {
    let text = raw;
    for (;;) {
      let best: { name: string; at: number } | null = null;
      for (const name of GEMINI_SECTIONS) {
        const at = text.indexOf(name);
        if (at < 0) continue;
        if (!best || at < best.at || (at === best.at && name.length > best.name.length)) {
          best = { name, at };
        }
      }
      if (!best) break;

      const head = text.slice(0, best.at).trim();
      if (head) current.lines.push({ text: head, line: idx + 1 });
      out.push(current);
      current = { section: best.name, lines: [] };
      text = text.slice(best.at + best.name.length);
    }
    if (text.trim()) current.lines.push({ text: text.trim(), line: idx + 1 });
  });

  out.push(current);
  return out.filter((s) => s.lines.length);
}

export function parseGeminiResearch(text: string, fileName: string): ResearchClaim[] {
  const claims: ResearchClaim[] = [];

  // Only the "PERSON #n" blocks are parsed as records. The surrounding essay
  // and the trailing JSON are handled separately and deliberately: prose is
  // not a schema, and the JSON restates the blocks with less provenance.
  const blocks = [...text.matchAll(/PERSON #(\d+)([\s\S]*?)(?=PERSON #\d+|MACHINE-READABLE DATA|$)/g)];

  for (const [, , body] of blocks) {
    const sections = splitGeminiSections(body!);
    const nameLine = sections.flatMap((s) => s.lines).find((l) => /^Official Name:/i.test(l.text));
    const subjectName = nameLine ? nameLine.text.replace(/^Official Name:\s*/i, "").trim() : null;
    if (!subjectName) continue;

    // The block's own SOURCES section provides URLs; keep them for tiering.
    const sourceSection = sections.find((s) => s.section === "SOURCES");
    const sourceText = sourceSection?.lines.map((l) => l.text).join(" ") ?? "";

    for (const { section, lines } of sections) {
      if (section === "IDENTITY") {
        for (const { text: t, line } of lines) {
          const kv = /^(Date of Birth|Place of Birth|Profession):\s*(.*)$/i.exec(t);
          if (!kv) continue;
          const value = kv[2]!.trim();
          if (!value || isNotVerified(value)) continue;
          const target = /Date of Birth/i.test(kv[1]!) ? "date-of-birth"
            : /Place of Birth/i.test(kv[1]!) ? "place-of-birth" : "profession";
          claims.push(makeClaim(subjectName, target, value, t, line, fileName, sourceText));
        }
        continue;
      }

      const starter = ENTITY_STARTERS[section];
      const sectionField = SECTION_FIELD[section];
      if (!starter && !sectionField) continue;

      // An entity is a RUN of Key: Value lines beginning at a starter key.
      // Grouping matters for provenance: a credential's own "Source:" line
      // sits beneath it, and splitting them apart makes the credential
      // inherit the block's generic source list instead of its actual one.
      let buffer: string[] = [];
      let startLine = 0;
      let field: ResearchField | null = sectionField ?? null;

      const emit = (): void => {
        if (buffer.length && field) {
          const value = buffer.join("; ");
          if (!isNotVerified(value)) {
            claims.push(makeClaim(subjectName, field, value, buffer[0]!, startLine, fileName, sourceText));
          }
        }
        buffer = [];
      };

      const unglued = lines.flatMap(({ text: t, line }) =>
        ungluedEntities(t, starter).map((text) => ({ text, line })));

      for (const { text: t, line } of unglued) {
        const kv = /^([A-Za-z/ ]+?):\s*(.*)$/.exec(t);
        if (!kv) continue;
        const key = kv[1]!.trim();
        const value = kv[2]!.trim();

        if (isStarterKey(starter, key)) {
          emit();
          startLine = line;
          if (section === "EDUCATION") field = educationFieldFor(key);
        }
        if (!buffer.length) startLine = line;
        if (value && !isNotVerified(value)) buffer.push(`${key}: ${value}`);
        // A bare starter with no value ("Postgraduate:") still opens an
        // entity — the detail follows on the next lines.
        else if (isStarterKey(starter, key)) buffer.push(key);
      }
      emit();
    }
  }

  return claims;
}

function makeClaim(
  subjectName: string, field: ResearchField, value: string,
  rawText: string, line: number, file: string, sourceText: string,
): ResearchClaim {
  // A claim's own "Source:" wins over the block's source list.
  const own = /Source:\s*([^;]+)/i.exec(value)?.[1]?.trim() ?? null;
  const status = /Status:\s*([^;]+)/i.exec(value)?.[1]?.trim() ?? null;
  const cited = own ?? (sourceText ? firstCitedInstitution(sourceText) : null);
  const url = firstUrl(value) ?? (own ? null : firstUrl(sourceText));
  return {
    subjectName, field, value,
    citedSource: cited,
    sourceUrl: url,
    tier: tierFor(cited, url),
    selfReportedStatus: status ?? (own && /secondary/i.test(own) ? own : null),
    file, line, rawText,
  };
}

function firstCitedInstitution(sourceText: string): string | null {
  const m = /Institution:\s*([^\n;]+)/i.exec(sourceText);
  return m ? m[1]!.trim() : null;
}

/* ==========================================================================
   Entry point
   ========================================================================== */

export function parseResearchFile(text: string, fileName: string): ResearchClaim[] {
  // The Gemini file is identifiable by its record delimiter; the ChatGPT file
  // by its markdown headings. Sniffing beats a caller-supplied flag that can
  // be passed wrongly.
  return /PERSON #\d+/.test(text)
    ? parseGeminiResearch(text, fileName)
    : parseChatGptResearch(text, fileName);
}
