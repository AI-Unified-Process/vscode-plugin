import {
  ALT_FLOW_HEADING,
  BUSINESS_RULE_SITE,
  MAIN_SCENARIO_HEADING,
  USE_CASE_ID_LINE,
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
