/**
 * The convention contract with AI Unified Process consumer projects, ported from the
 * IntelliJ plugin's `UseCaseIndex`. Every component that parses spec bodies
 * or file names shares these patterns so the accepted shapes stay in sync.
 *
 * Convention:
 *  - Use Case IDs are `UC-XXX`, or the `SUC-XXX` / `BUC-XXX` variants
 *    (System / Business Use Case).
 *  - Spec files are Markdown files declaring the ID via the body line
 *    `**Use Case ID:** UC-XXX` or via the H1 title (`# UC-001: Kunde suchen`,
 *    the German AI Unified Process spec style). The ID in the file name is a fallback,
 *    optionally preceded by a project prefix (`petclinic-UC-002-view.md`).
 *  - Test methods are annotated with `@UseCase(id = "UC-XXX", ...)`.
 */

/** Matches the `**Use Case ID:** UC-XXX` declaration line. */
export const USE_CASE_ID_LINE = /\*\*Use Case ID:\*\*\s*([SB]?UC-[A-Za-z0-9_-]+)/;

/**
 * H1 title that declares the Use Case ID directly, e.g. `# UC-001: Kunde
 * suchen` — the German AI Unified Process spec style, which has no `**Use Case ID:**`
 * body line. Only consulted as a fallback when no body line exists.
 */
export const USE_CASE_TITLE = /^#[ \t]+([SB]?UC-[A-Za-z0-9_-]+)/m;

/**
 * Name of a BPMN activity that references a use case by leading ID, e.g.
 * `UC-004 Find Owners by Last Name` or `UC-004: …`. Shared with the BPMN editor
 * webview.
 */
export const ACTIVITY_USE_CASE_REF = /^\s*([SB]?UC-[A-Za-z0-9_-]*[A-Za-z0-9])/;

/**
 * A Use Case reference in a code comment, the marker the implementation
 * carries instead of `@UseCase`: `UC-002`, `UC-002 BR-001` or `UC-010 A2`.
 * Group 1 is the Use Case ID, group 2 the optional business rule or
 * alternative-flow code. The lookbehind keeps `UC-002` from matching
 * inside `SUC-002` or `foo-UC-002`.
 */
export const USE_CASE_REFERENCE =
  /(?<![\p{L}\p{N}_-])([SB]?UC-[A-Za-z0-9_-]*[A-Za-z0-9])(?:[ \t]+((?:BR|GR)-[A-Za-z0-9_-]*[A-Za-z0-9]|[A-Z]\d+|\d+[a-z])\b)?/gu;

const BUSINESS_RULE_ID = /^(?:BR|GR)-.+$/;

/**
 * Heading of the main flow section: `Main Success Scenario` (English),
 * `Hauptszenario` or `Hauptablauf` (German).
 */
export const MAIN_SCENARIO_HEADING =
  /^#{1,6}\s+(?:Main\s+Success\s+Scenario|Hauptszenario|Hauptablauf)\s*$/;

/** The labels accepted as the main flow in `@UseCase(scenario = ...)`. */
export const MAIN_SCENARIO_LABELS = ['Main Success Scenario', 'Hauptszenario', 'Hauptablauf'];

/**
 * Alternative-flow heading: `### A1: …` (letter-digit codes) or the
 * step-coded German style `### 3a. Keine Treffer gefunden`.
 */
export const ALT_FLOW_HEADING = /^#{1,6}\s+([A-Z]\d+|\d+[a-z])\b/;

/**
 * A business-rule declaration site: a heading (`### BR-001 …`) or a bold
 * bullet item (`- **GR-008:** …`, the German spec style). Accepts the
 * `BR-` and `GR-` (Geschäftsregel) prefixes.
 */
export const BUSINESS_RULE_SITE = /^(?:#{1,6}\s+|\s*[-*]\s+\*\*)((?:BR|GR)-[A-Za-z0-9_-]+)\b/;

/**
 * The code prefix of a scenario label: `A1` in "A1: Missing Description"
 * or the step-coded `3a` in "3a: Keine Treffer gefunden".
 */
export const SCENARIO_CODE = /^(?:[A-Z]\d+|\d+[a-z])$/i;

/**
 * File names that identify a spec without reading it: `UC-XXX(-...)`,
 * `SUC-...`, `BUC-...`, each optionally preceded by an arbitrary
 * `<prefix>-` (e.g. `petclinic-UC-002-view-veterinarians`). The tail
 * accepts any letters (incl. umlauts), digits, `-` and `_`.
 */
export const SPEC_FILE_NAME = /^(?:.*-)?[SB]?UC-[\p{L}\p{N}_-]+$/u;

/** A Use Case, or one of its business rules or alternative flows, named in a code comment. */
export interface UseCaseReference {
  useCaseId: string;
  qualifier?: string;
}

export function referenceLabel(reference: UseCaseReference): string {
  return reference.qualifier ? `${reference.useCaseId} ${reference.qualifier}` : reference.useCaseId;
}

export function isBusinessRuleId(qualifier: string): boolean {
  return BUSINESS_RULE_ID.test(qualifier);
}

/**
 * The Use Case references in a comment text, each with its offsets in that
 * text. A qualifier applies to the whole `/` list before it:
 * `UC-007 / UC-008 BR-001` names BR-001 of both.
 */
export function locateUseCaseReferences(
  text: string,
): { reference: UseCaseReference; start: number; end: number }[] {
  const matches = [...text.matchAll(USE_CASE_REFERENCE)];
  const qualifiers = matches.map((match) => match[2] as string | undefined);
  for (let i = matches.length - 2; i >= 0; i--) {
    const separator = text.slice(matches[i].index + matches[i][0].length, matches[i + 1].index);
    if (qualifiers[i] === undefined && separator.trim() === '/') {
      qualifiers[i] = qualifiers[i + 1];
    }
  }
  return matches.map((match, i) => ({
    reference: qualifiers[i]
      ? { useCaseId: match[1], qualifier: qualifiers[i] }
      : { useCaseId: match[1] },
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/**
 * True if a reference is a marker of the Use Case: of that rule or flow with a
 * [qualifier], any marker of the Use Case without one.
 */
export function referenceMatches(
  reference: UseCaseReference,
  useCaseId: string,
  qualifier?: string,
): boolean {
  return (
    reference.useCaseId === useCaseId &&
    (qualifier === undefined || reference.qualifier?.toLowerCase() === qualifier.toLowerCase())
  );
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if the (extension-less) file name alone marks the file as a Use Case spec. */
export function isSpecFileName(nameWithoutExtension: string): boolean {
  return SPEC_FILE_NAME.test(nameWithoutExtension);
}

/**
 * True if the file name contains the ID at `-`/`_` boundaries, like
 * "UC-002-view-veterinarians" or "UC-032_Kunden_bearbeiten". The leading
 * boundary must be a literal `-` (or the name start) so that e.g. UC-002
 * does not match a SUC-002 spec.
 */
export function fileNameMatchesUseCase(nameWithoutExtension: string, useCaseId: string): boolean {
  return new RegExp(`^(?:.*-)?${escapeRegExp(useCaseId)}(?:[-_].*)?$`).test(nameWithoutExtension);
}

/**
 * The Use Case ID a spec body declares: the `**Use Case ID:** UC-XXX` line
 * takes precedence, the H1 title (`# UC-001: …`) is the fallback.
 */
export function findDeclaredUseCaseId(content: string): string | undefined {
  return USE_CASE_ID_LINE.exec(content)?.[1] ?? USE_CASE_TITLE.exec(content)?.[1];
}

/** The use case a BPMN activity references by the leading ID of its name, if any. */
export function activityUseCaseId(name: string): string | undefined {
  return ACTIVITY_USE_CASE_REF.exec(name)?.[1];
}

export function isMainScenarioLabel(value: string): boolean {
  return MAIN_SCENARIO_LABELS.some((label) => label.toLowerCase() === value.toLowerCase());
}

/**
 * Extracts the alt-flow code prefix from a scenario value, e.g.
 * "A1: Missing Description" -> "A1" or "3a: Keine Treffer" -> "3a".
 * Returns undefined if the value doesn't follow either code form.
 */
export function scenarioPrefix(scenario: string): string | undefined {
  const colon = scenario.indexOf(':');
  const prefix = (colon >= 0 ? scenario.slice(0, colon) : scenario).trim();
  return SCENARIO_CODE.test(prefix) ? prefix : undefined;
}
