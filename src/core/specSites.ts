import {
  ALT_FLOW_HEADING,
  BUSINESS_RULE_SITE,
  MAIN_SCENARIO_HEADING,
  USE_CASE_ID_LINE,
  USE_CASE_TITLE,
  UseCaseReference,
} from './patterns';

/**
 * The navigation sites a single spec line can carry, in the same precedence
 * order the IntelliJ plugin's `SpecToUseCaseLineMarkerProvider` uses:
 * the `**Use Case ID:**` line, a business-rule site, the H1 title, the
 * main-scenario heading, an alternative-flow heading.
 */
export type SpecSite =
  | { kind: 'useCaseId'; id: string }
  | { kind: 'businessRule'; brId: string }
  | { kind: 'title' }
  | { kind: 'mainScenario' }
  | { kind: 'altFlow'; code: string };

const TITLE_HEADING = /^# \S/;

export function classifySpecLine(lineText: string): SpecSite | undefined {
  const ucMatch = USE_CASE_ID_LINE.exec(lineText);
  if (ucMatch) {
    return { kind: 'useCaseId', id: ucMatch[1] };
  }
  const brMatch = BUSINESS_RULE_SITE.exec(lineText);
  if (brMatch) {
    return { kind: 'businessRule', brId: brMatch[1] };
  }
  if (TITLE_HEADING.test(lineText)) {
    return { kind: 'title' };
  }
  if (MAIN_SCENARIO_HEADING.test(lineText)) {
    return { kind: 'mainScenario' };
  }
  const afMatch = ALT_FLOW_HEADING.exec(lineText);
  if (afMatch) {
    return { kind: 'altFlow', code: afMatch[1] };
  }
  return undefined;
}

/**
 * The markers a spec line links to in the implementation, like the IntelliJ
 * plugin's `SpecToImplementationLineMarkerProvider`: the `**Use Case ID:**`
 * line, or the H1 title of a spec without that line, for every marker of the
 * Use Case; a business-rule site or alternative-flow heading for its own.
 * The Main Success Scenario has no markers.
 */
export function implementationSite(
  lineText: string,
  declaredUseCaseId: string | undefined,
  hasUseCaseIdLine: boolean,
): UseCaseReference | undefined {
  const idLine = USE_CASE_ID_LINE.exec(lineText);
  if (idLine) {
    return { useCaseId: idLine[1] };
  }
  if (!declaredUseCaseId) {
    return undefined;
  }
  const qualifier = BUSINESS_RULE_SITE.exec(lineText)?.[1] ?? ALT_FLOW_HEADING.exec(lineText)?.[1];
  if (qualifier) {
    return { useCaseId: declaredUseCaseId, qualifier };
  }
  const isTitleSite = !hasUseCaseIdLine && USE_CASE_TITLE.exec(lineText)?.[1] === declaredUseCaseId;
  return isTitleSite ? { useCaseId: declaredUseCaseId } : undefined;
}
