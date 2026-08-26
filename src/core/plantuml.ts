/**
 * PlantUML source handling shared by the preview: splitting a `.puml` file into
 * its individual diagrams and encoding a diagram for a PlantUML server URL.
 *
 * Kept free of `vscode` imports so it stays unit-testable, like the rest of
 * `src/core`.
 */

import { deflateRawSync } from 'node:zlib';

/** `@startuml`, `@startmindmap`, `@startgantt`, … — the opening of a diagram. */
const START_TAG = /^\s*@start([a-z]+)\b/;

/** The alphabet of PlantUML's own base64 variant (not RFC 4648). */
const ENCODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

/**
 * Splits the text of a `.puml` file into its diagrams, each one a complete
 * `@start…`/`@end…` block. A file may hold several diagrams; the preview
 * renders one image per block.
 *
 * Text outside any block is ignored (that is what PlantUML itself does). A file
 * without any `@start…` tag is treated as a single `@startuml` diagram, and an
 * unterminated block is closed so a renderer never waits for the missing tag.
 */
export function splitDiagrams(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const diagrams: string[] = [];
  let current: string[] | undefined;
  let keyword = '';

  for (const line of lines) {
    if (!current) {
      const start = START_TAG.exec(line);
      if (start) {
        keyword = start[1];
        current = [line];
      }
      continue;
    }
    current.push(line);
    if (new RegExp(`^\\s*@end${keyword}\\b`).test(line)) {
      diagrams.push(current.join('\n'));
      current = undefined;
    }
  }

  if (current) {
    current.push(`@end${keyword}`);
    diagrams.push(current.join('\n'));
  }
  if (diagrams.length === 0 && text.trim() !== '') {
    diagrams.push(`@startuml\n${text.trim()}\n@enduml`);
  }
  return diagrams;
}

/**
 * Encodes a diagram the way PlantUML servers expect it: raw deflate, then
 * PlantUML's own base64 variant.
 */
export function encodeDiagram(source: string): string {
  return encode64(deflateRawSync(Buffer.from(source, 'utf8'), { level: 9 }));
}

/**
 * The URL that renders `source` on a PlantUML server, e.g.
 * `https://www.plantuml.com/plantuml/svg/SyfFKj2rKt3CoKnE…`.
 */
export function serverUrl(server: string, format: string, source: string): string {
  return `${server.replace(/\/+$/, '')}/${format}/${encodeDiagram(source)}`;
}

function encode64(data: Buffer): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    out += append3bytes(data[i], i + 1 < data.length ? data[i + 1] : 0, i + 2 < data.length ? data[i + 2] : 0);
  }
  return out;
}

function append3bytes(b1: number, b2: number, b3: number): string {
  return (
    ENCODE_ALPHABET.charAt(b1 >> 2) +
    ENCODE_ALPHABET.charAt(((b1 & 0x3) << 4) | (b2 >> 4)) +
    ENCODE_ALPHABET.charAt(((b2 & 0xf) << 2) | (b3 >> 6)) +
    ENCODE_ALPHABET.charAt(b3 & 0x3f)
  );
}
