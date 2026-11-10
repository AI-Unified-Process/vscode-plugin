import { describe, expect, it } from 'vitest';
import {
  activityUseCaseId,
  fileNameMatchesUseCase,
  findDeclaredUseCaseId,
  isBusinessRuleId,
  isSpecFileName,
  locateUseCaseReferences,
  referenceLabel,
  referenceMatches,
  scenarioPrefix,
} from './patterns';
import { classifySpecLine, implementationSite } from './specSites';

describe('spec file names', () => {
  it('accepts plain, prefixed and variant IDs', () => {
    expect(isSpecFileName('UC-002-view-veterinarians')).toBe(true);
    expect(isSpecFileName('UC-032_Kundeninformationen_bearbeiten')).toBe(true);
    expect(isSpecFileName('petclinic-UC-002-view-veterinarians')).toBe(true);
    expect(isSpecFileName('SUC-001-import')).toBe(true);
    expect(isSpecFileName('BUC-001-billing')).toBe(true);
    expect(isSpecFileName('README')).toBe(false);
  });

  it('matches an ID only at boundaries', () => {
    expect(fileNameMatchesUseCase('UC-002-view-veterinarians', 'UC-002')).toBe(true);
    expect(fileNameMatchesUseCase('petclinic-UC-002-view', 'UC-002')).toBe(true);
    expect(fileNameMatchesUseCase('UC-032_Kunden_bearbeiten', 'UC-032')).toBe(true);
    // UC-002 must not match a SUC-002 spec
    expect(fileNameMatchesUseCase('SUC-002-import', 'UC-002')).toBe(false);
    // UC-002 must not match UC-0021
    expect(fileNameMatchesUseCase('UC-0021-other', 'UC-002')).toBe(false);
  });
});

describe('activityUseCaseId', () => {
  it('reads the leading ID of a BPMN activity name', () => {
    expect(activityUseCaseId('UC-004 Find Owners by Last Name')).toBe('UC-004');
    expect(activityUseCaseId('UC-001: Kunde suchen')).toBe('UC-001');
    expect(activityUseCaseId(' SUC-002 View Owners')).toBe('SUC-002');
    expect(activityUseCaseId('BUC-001')).toBe('BUC-001');
  });

  it('ignores names that do not start with an ID', () => {
    expect(activityUseCaseId('Find Owners (UC-004)')).toBeUndefined();
    expect(activityUseCaseId('RUC-001 Not a use case')).toBeUndefined();
  });
});

describe('findDeclaredUseCaseId', () => {
  it('prefers the body line over the title', () => {
    expect(findDeclaredUseCaseId('# UC-001: Titel\n\n**Use Case ID:** UC-002\n')).toBe('UC-002');
  });

  it('falls back to the H1 title (German spec style)', () => {
    expect(findDeclaredUseCaseId('# UC-001: Kunde suchen\n\n## Hauptablauf\n')).toBe('UC-001');
  });

  it('returns undefined without a declaration', () => {
    expect(findDeclaredUseCaseId('# Just a readme\n')).toBeUndefined();
  });
});

describe('scenarioPrefix', () => {
  it('extracts letter-digit and step-coded prefixes', () => {
    expect(scenarioPrefix('A1: Missing Description')).toBe('A1');
    expect(scenarioPrefix('3a: Keine Treffer')).toBe('3a');
    expect(scenarioPrefix('A2')).toBe('A2');
    expect(scenarioPrefix('Main Success Scenario')).toBeUndefined();
  });
});

describe('classifySpecLine', () => {
  it('recognises the sites of the IntelliJ gutter icons', () => {
    expect(classifySpecLine('**Use Case ID:** UC-002')).toEqual({
      kind: 'useCaseId',
      id: 'UC-002',
    });
    expect(classifySpecLine('### BR-001: Lazy Loading')).toEqual({
      kind: 'businessRule',
      brId: 'BR-001',
    });
    expect(classifySpecLine('- **BR-008:** Inaktive Kunden werden nicht angezeigt.')).toEqual({
      kind: 'businessRule',
      brId: 'BR-008',
    });
    expect(classifySpecLine('# View Veterinarians')).toEqual({ kind: 'title' });
    expect(classifySpecLine('## Main Success Scenario')).toEqual({ kind: 'mainScenario' });
    expect(classifySpecLine('## Hauptablauf')).toEqual({ kind: 'mainScenario' });
    expect(classifySpecLine('### A1: No Veterinarians Found')).toEqual({
      kind: 'altFlow',
      code: 'A1',
    });
    expect(classifySpecLine('### 3a. Keine Treffer gefunden')).toEqual({
      kind: 'altFlow',
      code: '3a',
    });
    expect(classifySpecLine('Some ordinary paragraph.')).toBeUndefined();
    expect(classifySpecLine('## Preconditions')).toBeUndefined();
  });
});

describe('use case references', () => {
  const references = (text: string) => locateUseCaseReferences(text).map((r) => r.reference);

  it('reads the ID with its optional rule or flow', () => {
    expect(references('UC-002 BR-001: Rows load lazily.')).toEqual([
      { useCaseId: 'UC-002', qualifier: 'BR-001' },
    ]);
    expect(references('UC-010 A2: Error view')).toEqual([{ useCaseId: 'UC-010', qualifier: 'A2' }]);
    expect(references('UC-001 3a')).toEqual([{ useCaseId: 'UC-001', qualifier: '3a' }]);
    expect(references('UC-002: View Veterinarians')).toEqual([{ useCaseId: 'UC-002' }]);
  });

  it('does not match inside a longer ID', () => {
    expect(references('foo-UC-002 XUC-002')).toEqual([]);
    expect(references('SUC-002 BR-008: Regel')).toEqual([{ useCaseId: 'SUC-002', qualifier: 'BR-008' }]);
  });

  it('takes no word after the ID for a qualifier', () => {
    expect(references('UC-002 View Veterinarians, see UC-001 3a.')).toEqual([
      { useCaseId: 'UC-002' },
      { useCaseId: 'UC-001', qualifier: '3a' },
    ]);
  });

  it('shares a qualifier across a slash list', () => {
    expect(references('UC-007 / UC-008 BR-001: Unique per owner.')).toEqual([
      { useCaseId: 'UC-007', qualifier: 'BR-001' },
      { useCaseId: 'UC-008', qualifier: 'BR-001' },
    ]);
  });

  it('locates the reference in the text', () => {
    const text = '// see UC-002 BR-001: Rows.';
    const [{ start, end }] = locateUseCaseReferences(text);
    expect(text.slice(start, end)).toBe('UC-002 BR-001');
  });

  it('labels and classifies references', () => {
    expect(referenceLabel({ useCaseId: 'UC-002' })).toBe('UC-002');
    expect(referenceLabel({ useCaseId: 'UC-002', qualifier: 'A2' })).toBe('UC-002 A2');
    expect(isBusinessRuleId('BR-008')).toBe(true);
    expect(isBusinessRuleId('A2')).toBe(false);
  });

  it('matches markers of the rule, or all of the Use Case', () => {
    const marker = { useCaseId: 'UC-002', qualifier: 'BR-001' };
    expect(referenceMatches(marker, 'UC-002')).toBe(true);
    expect(referenceMatches(marker, 'UC-002', 'br-001')).toBe(true);
    expect(referenceMatches(marker, 'UC-002', 'BR-009')).toBe(false);
    expect(referenceMatches(marker, 'UC-003', 'BR-001')).toBe(false);
    expect(referenceMatches({ useCaseId: 'UC-002' }, 'UC-002', 'BR-001')).toBe(false);
  });
});

describe('implementationSite', () => {
  it('links the ID line to every marker of the Use Case', () => {
    expect(implementationSite('**Use Case ID:** UC-002', 'UC-002', true)).toEqual({ useCaseId: 'UC-002' });
  });

  it('links rule and flow sites to their own markers', () => {
    expect(implementationSite('### BR-001: Lazy', 'UC-002', true)).toEqual({
      useCaseId: 'UC-002',
      qualifier: 'BR-001',
    });
    expect(implementationSite('- **BR-008:** Regel', 'UC-001', false)).toEqual({
      useCaseId: 'UC-001',
      qualifier: 'BR-008',
    });
    expect(implementationSite('### 3a. Keine Treffer', 'UC-001', false)).toEqual({
      useCaseId: 'UC-001',
      qualifier: '3a',
    });
  });

  it('uses the H1 title only without an ID line', () => {
    expect(implementationSite('# UC-001: Kunde suchen', 'UC-001', false)).toEqual({ useCaseId: 'UC-001' });
    expect(implementationSite('# UC-001: Kunde suchen', 'UC-001', true)).toBeUndefined();
    expect(implementationSite('# View Veterinarians', 'UC-002', true)).toBeUndefined();
  });

  it('has no site on the main scenario or outside a spec', () => {
    expect(implementationSite('## Main Success Scenario', 'UC-002', true)).toBeUndefined();
    expect(implementationSite('### BR-001: Lazy', undefined, false)).toBeUndefined();
  });
});
