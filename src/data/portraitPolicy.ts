/**
 * Javora — portrait display policy.
 *
 * TWO SEPARATE QUESTIONS, deliberately kept apart:
 *
 *   1. What are the rights?  A fact about the source, recorded truthfully in
 *      `person.portrait_rights`. For parliament.lk the answer is
 *      "all-rights-reserved": the site carries "Copyright © The Parliament of
 *      Sri Lanka. All Rights Reserved." and publishes no reuse licence.
 *
 *   2. Does Javora display it?  A decision by whoever runs the deployment.
 *
 * Conflating the two would mean either lying about the rights in order to
 * show a portrait, or pretending no portrait exists because its licence is
 * unstated. Both are worse than recording the fact and stating the decision.
 *
 * THE DECISION, AND ITS BASIS
 *
 * Official portraits of sitting members are displayed alongside those
 * members' public records, hot-linked to the publishing institution with
 * visible credit. The reasoning: these are official photographs of public
 * officials, published by the institution precisely so that citizens can
 * identify their representatives, reproduced here for identification in a
 * civic-record context, at thumbnail scale, with attribution, and without
 * being copied into this repository or redistributed as a dataset.
 *
 * That is a fair-dealing judgement, and it belongs to the operator of the
 * deployment rather than to this file. Set `DISPLAY_PORTRAITS` to false to
 * fall back to monograms everywhere; nothing else needs to change, and the
 * rights metadata is unaffected either way.
 *
 * If Parliament asks for the portraits to be removed, flipping this flag is
 * the whole remedy.
 */

export const PORTRAIT_DISPLAY_POLICY = {
  /** Master switch. False → monogram everywhere, rights data untouched. */
  displayPortraits: true,

  /**
   * Show credit next to the portrait on the profile page.
   *
   * Not optional in practice: an official portrait shown without attribution
   * is the thing most likely to draw a legitimate objection.
   */
  showCredit: true,

  /**
   * Hot-link rather than copy.
   *
   * Keeping the bytes on the institution's own servers means Javora is not
   * redistributing the images, the institution keeps its access logs, and a
   * portrait the institution replaces or withdraws changes here too.
   */
  hotlink: true,
} as const;

export const shouldDisplayPortraits = (): boolean => PORTRAIT_DISPLAY_POLICY.displayPortraits;
