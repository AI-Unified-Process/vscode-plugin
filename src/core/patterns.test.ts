import { describe, expect, it } from 'vitest';
import {
  fileNameMatchesUseCase,
  findDeclaredUseCaseId,
  isSpecFileName,
  scenarioPrefix,
} from './patterns';
import { classifySpecLine } from './specSites';

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
    expect(classifySpecLine('- **GR-008:** Inaktive Kunden werden nicht angezeigt.')).toEqual({
      kind: 'businessRule',
      brId: 'GR-008',
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
