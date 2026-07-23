import { describe, expect, it } from 'vitest';
import { scanJavaSource } from './javaScan';

const source = `package com.example.petclinic;

import org.junit.jupiter.api.Test;

class VetListViewTest {

\t@UseCase(id = "UC-002")
\t@Test
\tvoid showsAllVeterinarians() {
\t}

\t@UseCase(id = "UC-002", scenario = "A1: No Veterinarians Found", businessRules = {"BR-001", "BR-002"})
\t@Test
\tvoid showsEmptyState() {
\t\tif (true) {
\t\t}
\t}

\t@UseCase(id = "UC-003", businessRules = "BR-007")
\t@DisplayName("with (parens) inside")
\t@Test
\tvoid singleRule() {
\t}
}
`;

describe('scanJavaSource', () => {
  it('finds all @UseCase annotations with their attributes', () => {
    const result = scanJavaSource(source);

    expect(result.annotations).toHaveLength(3);
    expect(result.annotations[0].id).toBe('UC-002');
    expect(result.annotations[0].scenario).toBeUndefined();
    expect(result.annotations[0].businessRules).toEqual([]);

    expect(result.annotations[1].id).toBe('UC-002');
    expect(result.annotations[1].scenario).toBe('A1: No Veterinarians Found');
    expect(result.annotations[1].businessRules.map((r) => r.value)).toEqual([
      'BR-001',
      'BR-002',
    ]);

    expect(result.annotations[2].businessRules.map((r) => r.value)).toEqual(['BR-007']);
  });

  it('resolves the annotated method name, skipping other annotations', () => {
    const result = scanJavaSource(source);

    expect(result.annotations[0].methodName).toBe('showsAllVeterinarians');
    expect(result.annotations[1].methodName).toBe('showsEmptyState');
    expect(result.annotations[2].methodName).toBe('singleRule');
  });

  it('reports the containing class', () => {
    const result = scanJavaSource(source);

    expect(result.className).toBe('VetListViewTest');
    expect(source.slice(result.classNameStart, result.classNameStart + 15)).toBe(
      'VetListViewTest',
    );
  });

  it('records the offsets of the id literal', () => {
    const result = scanJavaSource(source);
    const { idStart, idEnd } = result.annotations[0];

    expect(source.slice(idStart, idEnd)).toBe('UC-002');
  });

  it('detects the annotation type declaration', () => {
    expect(scanJavaSource('public @interface UseCase { String id(); }').hasAnnotationType).toBe(
      true,
    );
    expect(scanJavaSource(source).hasAnnotationType).toBe(false);
  });
});
