import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeDiagram, serverUrl, splitDiagrams } from './plantuml';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

/** The inverse of PlantUML's base64 variant, so the tests can round-trip. */
function decode(encoded: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 4) {
    const c = [0, 1, 2, 3].map((n) => ALPHABET.indexOf(encoded.charAt(i + n)));
    bytes.push(((c[0] << 2) | (c[1] >> 4)) & 0xff);
    bytes.push((((c[1] & 0xf) << 4) | (c[2] >> 2)) & 0xff);
    bytes.push((((c[2] & 0x3) << 6) | c[3]) & 0xff);
  }
  return inflateRawSync(Buffer.from(bytes)).toString('utf8');
}

describe('splitDiagrams', () => {
  it('returns each @startuml block', () => {
    const text = '# notes\n@startuml\nBob -> Alice\n@enduml\n\nprose\n\n@startuml\nA -> B\n@enduml\n';
    expect(splitDiagrams(text)).toEqual([
      '@startuml\nBob -> Alice\n@enduml',
      '@startuml\nA -> B\n@enduml',
    ]);
  });

  it('keeps non-uml diagram types together with their own end tag', () => {
    const text = '@startmindmap\n* root\n@endmindmap\n@startuml\nA -> B\n@enduml';
    expect(splitDiagrams(text)).toEqual(['@startmindmap\n* root\n@endmindmap', '@startuml\nA -> B\n@enduml']);
  });

  it('does not end a block on a foreign end tag', () => {
    const text = '@startuml\ntitle @endmindmap\nA -> B\n@enduml';
    expect(splitDiagrams(text)).toEqual(['@startuml\ntitle @endmindmap\nA -> B\n@enduml']);
  });

  it('closes an unterminated block', () => {
    expect(splitDiagrams('@startuml\nA -> B\n')).toEqual(['@startuml\nA -> B\n\n@enduml']);
  });

  it('wraps a file without any start tag', () => {
    expect(splitDiagrams('A -> B\n')).toEqual(['@startuml\nA -> B\n@enduml']);
  });

  it('returns nothing for an empty file', () => {
    expect(splitDiagrams('   \n\n')).toEqual([]);
  });
});

describe('encodeDiagram', () => {
  const source = '@startuml\nBob -> Alice : hello\n@enduml';

  it('round-trips through PlantUML deflate + base64', () => {
    expect(decode(encodeDiagram(source))).toBe(source);
  });

  it('uses only URL-safe characters', () => {
    expect(encodeDiagram(source)).toMatch(/^[0-9A-Za-z_-]+$/);
  });

  it('handles non-ASCII spec text', () => {
    const german = '@startuml\ntitle Kunde suchen — Übersicht\n@enduml';
    expect(decode(encodeDiagram(german))).toBe(german);
  });
});

describe('serverUrl', () => {
  it('joins server, format and encoded source', () => {
    const url = serverUrl('https://www.plantuml.com/plantuml/', 'svg', '@startuml\nA -> B\n@enduml');
    expect(url.startsWith('https://www.plantuml.com/plantuml/svg/')).toBe(true);
    expect(decode(url.slice('https://www.plantuml.com/plantuml/svg/'.length))).toBe('@startuml\nA -> B\n@enduml');
  });
});
