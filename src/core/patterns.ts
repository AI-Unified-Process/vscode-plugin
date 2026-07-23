/**
 * The convention contract with AIUP consumer projects, ported from the
 * IntelliJ plugin's `UseCaseIndex`. Every component that parses spec bodies
 * or file names shares these patterns so the accepted shapes stay in sync.
 *
 * Convention:
 *  - Use Case IDs are `UC-XXX`, or the `SUC-XXX` / `BUC-XXX` variants
 *    (System / Business Use Case).
 *  - Spec files are Markdown files declaring the ID via the body line
 *    `**Use Case ID:** UC-XXX` or via the H1 title (`# UC-001: Kunde suchen`,
 *    the German AIUP spec style). The ID in the file name is a fallback,
 *    optionally preceded by a project prefix (`petclinic-UC-002-view.md`).
 *  - Test methods are annotated with `@UseCase(id = "UC-XXX", ...)`.
 */

/** Matches the `**Use Case ID:** UC-XXX` declaration line. */
export const USE_CASE_ID_LINE = /\*\*Use Case ID:\*\*\s*([SB]?UC-[A-Za-z0-9_-]+)/;

/**
 * H1 title that declares the Use Case ID directly, e.g. `# UC-001: Kunde
 * suchen` — the German AIUP spec style, which has no `**Use Case ID:**`
 * body line. Only consulted as a fallback when no body line exists.
 */
export const USE_CASE_TITLE = /^#[ \t]+([SB]?UC-[A-Za-z0-9_-]+)/m;

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
