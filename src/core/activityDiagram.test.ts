import { describe, expect, it } from 'vitest';
import { generateMermaid, generatePlantUml, parse } from './activityDiagram';

// Ported from the IntelliJ plugin's ActivityDiagramTest so both plugins keep
// reading specs the same way.

const spec = `# Use Case: Vision bearbeiten

## Overview

**Use Case ID:** UC-005
**Status:** Done

## Preconditions

- Der Benutzer ist angemeldet.

## Main Success Scenario

1. Benutzer öffnet die Vision.
2. System lädt den Dateiinhalt vom Git-Anbieter
   und zeigt ihn im Editor an.
3. Benutzer speichert die Datei (Ctrl+S).

## Alternative Flows

### A1: Datei nicht lesbar

**Trigger:** Das Markdown ist nicht lesbar (Schritt 2)
**Flow:**

1. System zeigt eine Fehlermeldung.
2. Use Case endet.

### A2: Ohne Schrittreferenz

**Trigger:** Etwas anderes passiert (UC-012 Schritt 8)
**Flow:**

1. System reagiert.

## Postconditions

### Success Postconditions

- Die Datei ist gespeichert.
`;

const germanSpec = `# UC-001: Kunde suchen

**Ziel:** Kunden suchen und auswählen

## Vorbedingungen

- Der Benutzer ist eingeloggt

## Hauptablauf

1. Der Benutzer öffnet die Kundensuche
2. Der Benutzer gibt Suchkriterien ein
3. Das System zeigt die Ergebnisse an
    - Oberhalb der Tabs wird eine Kopfzeile angezeigt
    - Die Detailansicht ist in zwei Tabs gegliedert
4. Das System zeigt die Details des Kunden an

## Alternativabläufe

### 2a. Keine Treffer gefunden

1. Das System zeigt eine Meldung an
2. Weiter mit Schritt 2

### 4a. Auftrag öffnen

1. Der Benutzer klickt auf die Auftragszeile
`;

describe('parse', () => {
  it('reads the main scenario with joined continuation lines', () => {
    const scenario = parse(spec);

    expect(scenario.mainSteps).toHaveLength(3);
    expect(scenario.mainSteps[1]).toBe(
      'System lädt den Dateiinhalt vom Git-Anbieter und zeigt ihn im Editor an.',
    );
  });

  it('reads alternative flows with trigger and steps', () => {
    const scenario = parse(spec);

    expect(scenario.flows).toHaveLength(2);
    expect(scenario.flows[0].title).toBe('Datei nicht lesbar');
    expect(scenario.flows[0].trigger).toBe('Das Markdown ist nicht lesbar (Schritt 2)');
    expect(scenario.flows[0].steps).toEqual([
      'System zeigt eine Fehlermeldung.',
      'Use Case endet.',
    ]);
  });

  it('supports the German main scenario heading', () => {
    const scenario = parse('## Hauptszenario\n\n1. Erster Schritt.\n');

    expect(scenario.mainSteps).toEqual(['Erster Schritt.']);
  });

  it('reads a German spec with Hauptablauf and step-coded flows', () => {
    const scenario = parse(germanSpec);

    expect(scenario.mainSteps).toHaveLength(4);
    // sub-bullets are detail, not part of the step label
    expect(scenario.mainSteps[2]).toBe('Das System zeigt die Ergebnisse an');

    expect(scenario.flows).toHaveLength(2);
    expect(scenario.flows[0].title).toBe('Keine Treffer gefunden');
    expect(scenario.flows[0].code).toBe('2a');
    expect(scenario.flows[0].branchStep).toBe(2);
    expect(scenario.flows[0].steps).toEqual([
      'Das System zeigt eine Meldung an',
      'Weiter mit Schritt 2',
    ]);
  });
});

describe('generatePlantUml', () => {
  it('branches a step-coded flow at its step', () => {
    const source = generatePlantUml(parse(germanSpec));

    const step2 = source.indexOf(':2. Der Benutzer gibt Suchkriterien ein;');
    const branch = source.indexOf('if (2a: Keine Treffer gefunden) then (2a)');
    const step3 = source.indexOf(':3. Das System zeigt die Ergebnisse an;');
    expect(step2).toBeGreaterThanOrEqual(0);
    expect(branch).toBeGreaterThan(step2);
    expect(step3).toBeGreaterThan(branch);

    const step4 = source.indexOf(':4. Das System zeigt die Details des Kunden an;');
    const branch4a = source.indexOf('if (4a: Auftrag öffnen) then (4a)');
    const stop = source.indexOf('stop');
    expect(step4).toBeGreaterThanOrEqual(0);
    expect(branch4a).toBeGreaterThan(step4);
    expect(stop).toBeGreaterThan(branch4a);
  });

  it('branches a flow at the step its trigger references', () => {
    const source = generatePlantUml(parse(spec));

    const step2 = source.indexOf(':2. System lädt');
    const branch = source.indexOf('if (A1:');
    const step3 = source.indexOf(':3. Benutzer speichert');
    expect(step2).toBeLessThan(branch);
    expect(branch).toBeLessThan(step3);
  });

  it('puts a flow without a step reference after the last step', () => {
    const source = generatePlantUml(parse(spec));

    // the UC-012 reference is not a step of this use case, so A2 branches at the end
    const step3 = source.indexOf(':3. Benutzer speichert');
    const branch = source.indexOf('if (A2:');
    const stop = source.indexOf('stop');
    expect(step3).toBeLessThan(branch);
    expect(branch).toBeLessThan(stop);
  });

  it('sanitizes labels', () => {
    const source = generatePlantUml(parse(spec));

    expect(source).toContain(':3. Benutzer speichert die Datei [Ctrl+S].;');
    expect(source).toContain('if (A1: Das Markdown ist nicht lesbar [Schritt 2]) then (A1)');
  });

  it('returns an empty source without main scenario steps', () => {
    expect(generatePlantUml(parse('# Use Case: Leer\n'))).toBe('');
  });
});

describe('generateMermaid', () => {
  it('returns an empty source without main scenario steps', () => {
    expect(generateMermaid(parse('# Use Case: Leer\n'))).toBe('');
  });

  it('builds the spine with branches rejoining before the next step', () => {
    const source = generateMermaid(parse(spec));

    expect(source).toContain('flowchart TD');
    expect(source).toContain('n_start([Start])');
    expect(source).toContain('n_end([End])');
    // the A1 decision sits between step 2 and step 3
    expect(source).toContain('s2 --> d1');
    expect(source).toContain('d1 -->|A1| f1_1');
    expect(source).toContain('f1_1 --> f1_2');
    // both the pass-through and the branch end rejoin at step 3
    expect(source).toContain('d1 --> s3');
    expect(source).toContain('f1_2 --> s3');
  });

  it('escapes double quotes in labels', () => {
    const source = generateMermaid(
      parse('## Main Success Scenario\n\n1. Benutzer klickt "Speichern".\n'),
    );

    expect(source).toContain('#quot;Speichern#quot;');
    expect(source).not.toMatch(/\["[^"]*"[^"]*"\]/);
  });
});
