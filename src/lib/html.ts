/**
 * Javora — shared scraping primitives: HTML entity decoding, tag stripping,
 * placeholder-aware cleaning, and request pacing.
 *
 * These are the primitives every connector and importer uses to turn raw
 * fetched HTML into text. Their duplication was a correctness risk specific
 * to this project: a fix to entity decoding — a name containing `&#x2019;`,
 * say — applied to one copy silently leaves the others producing a different
 * canonical name for the same person.
 *
 * WHAT MOVED HERE, verified byte-identical (or a strict superset — see below)
 * across every copy before moving:
 *   - decodeEntities: server/fetchers/cabinetOfficeConnector.ts,
 *     server/fetchers/parliamentConnector.ts, scripts/import-parliament.mjs,
 *     scripts/import-past-members.mjs
 *   - stripTags, clean, sleep: server/fetchers/parliamentConnector.ts,
 *     scripts/import-parliament.mjs, scripts/import-past-members.mjs
 *
 * WHAT DID NOT MOVE, and must not be merged in here:
 *   server/fetchers/parliamentProfileDetail.ts declares its OWN
 *   decodeEntities, stripTags and clean. They are genuinely different, not
 *   accidentally duplicated:
 *     - its decodeEntities decodes named entities via a NAMED_ENTITIES lookup
 *       table plus hex AND decimal numeric references, where the four merged
 *       here handle a fixed set of six named entities (amp, lt, gt, quot,
 *       apos/#39, nbsp) plus decimal only — no hex, no other named entities.
 *     - its stripTags does not collapse whitespace or trim, unlike the three
 *       merged here.
 *     - its clean treats null as null directly and never maps a run of dashes
 *       to null, unlike the three merged here, which treat the source's "---"
 *       placeholder as "no value".
 *   Merging either direction is a real behaviour change to a different
 *   source's markup, not a mechanical extraction, so it stays separate.
 *
 * ONE DELIBERATE UNION, not a silent pick of the shortest: three of the four
 * merged decodeEntities implementations decoded numeric references with
 * `String.fromCharCode`; server/fetchers/cabinetOfficeConnector.ts already
 * used `String.fromCodePoint`. The two agree on every codepoint below 0x10000
 * (verified: zero mismatches across all 65,536 BMP codepoints) — every
 * character Sinhala, Tamil, or Latin script can produce — and only diverge
 * for codepoints `fromCharCode` cannot represent at all (astral codepoints,
 * e.g. emoji), where it silently returns an empty or corrupted string and
 * `fromCodePoint` returns the correct character. `fromCodePoint` is therefore
 * a strict superset with no behavioural change for any input these sources
 * have ever produced, and is the version kept.
 */

/** Decode the handful of HTML entities these government sites actually use. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)));
}

/** Strip tags, decode entities, and collapse the source's generous whitespace. */
export const stripTags = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** The source writes "---" where it has no value; that is not a value. */
export const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? "").toString().trim();
  return !text || /^-+$/.test(text) ? null : text;
};

/** Pace requests so retrieval does not look like a burst to the source. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
