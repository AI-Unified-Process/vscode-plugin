/**
 * A lightweight Java source scanner for `@UseCase` annotations. VS Code has no
 * Java PSI, so the scanner is regex-based over raw text: good enough for the
 * AIUP convention (string-literal attributes on test methods) without pulling
 * in a Java language server dependency.
 */

export interface BusinessRuleRef {
  value: string;
  /** Offset of the literal's first content character (after the opening quote). */
  start: number;
  end: number;
}

export interface JavaUseCaseAnnotation {
  id?: string;
  /** Offsets of the id literal content (without quotes); annotation start if absent. */
  idStart: number;
  idEnd: number;
  scenario?: string;
  businessRules: BusinessRuleRef[];
  /** Offset of the `@` sign. */
  annotationStart: number;
  /** Offset just past the closing `)`. */
  annotationEnd: number;
  methodName?: string;
  methodNameStart: number;
}

export interface JavaScanResult {
  annotations: JavaUseCaseAnnotation[];
  /** True if this file declares `@interface UseCase`. */
  hasAnnotationType: boolean;
  className?: string;
  classNameStart: number;
}

const ANNOTATION_USE = /@UseCase\s*\(/g;
const ANNOTATION_TYPE = /@\s*interface\s+UseCase\b/;
const TYPE_DECLARATION = /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/;
const METHOD_CANDIDATE = /([A-Za-z_$][\w$]*)\s*\(/g;

/** Identifiers before `(` that can never be a method declaration name. */
const NON_METHOD_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'new',
  'return',
  'synchronized',
  'this',
  'super',
  'assert',
  'do',
  'try',
  'throw',
]);

/** How far past the annotation we look for the annotated method's name. */
const METHOD_SEARCH_WINDOW = 2000;

export function scanJavaSource(text: string): JavaScanResult {
  const annotations: JavaUseCaseAnnotation[] = [];
  ANNOTATION_USE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANNOTATION_USE.exec(text)) !== null) {
    const argsStart = match.index + match[0].length;
    const argsEnd = findMatchingParen(text, argsStart);
    if (argsEnd < 0) {
      break;
    }
    annotations.push(parseAnnotation(text, match.index, argsStart, argsEnd));
    ANNOTATION_USE.lastIndex = argsEnd + 1;
  }

  const typeMatch = TYPE_DECLARATION.exec(text);
  return {
    annotations,
    hasAnnotationType: ANNOTATION_TYPE.test(text),
    className: typeMatch?.[1],
    classNameStart: typeMatch ? typeMatch.index + typeMatch[0].indexOf(typeMatch[1]) : 0,
  };
}

function parseAnnotation(
  text: string,
  annotationStart: number,
  argsStart: number,
  argsEnd: number,
): JavaUseCaseAnnotation {
  const args = text.slice(argsStart, argsEnd);

  const idMatch = /\bid\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(args);
  const idContentStart = idMatch ? argsStart + idMatch.index + idMatch[0].indexOf('"') + 1 : -1;

  const scenarioMatch = /\bscenario\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(args);

  const businessRules: BusinessRuleRef[] = [];
  const brMatch = /\bbusinessRules\s*=\s*(\{[\s\S]*?\}|"(?:[^"\\]|\\.)*")/.exec(args);
  if (brMatch) {
    const groupStart = argsStart + brMatch.index + brMatch[0].indexOf(brMatch[1]);
    for (const literal of brMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const start = groupStart + literal.index + 1;
      businessRules.push({
        value: unescapeJava(literal[1]),
        start,
        end: start + literal[1].length,
      });
    }
  }

  const method = findAnnotatedMethod(text, argsEnd + 1);
  return {
    id: idMatch ? unescapeJava(idMatch[1]) : undefined,
    idStart: idMatch ? idContentStart : annotationStart,
    idEnd: idMatch ? idContentStart + idMatch[1].length : annotationStart + '@UseCase'.length,
    scenario: scenarioMatch ? unescapeJava(scenarioMatch[1]) : undefined,
    businessRules,
    annotationStart,
    annotationEnd: argsEnd + 1,
    methodName: method?.name,
    methodNameStart: method?.start ?? annotationStart,
  };
}

/**
 * The name of the method the annotation sits on: the first `identifier(` after
 * the annotation that is neither another annotation's name nor a keyword.
 */
function findAnnotatedMethod(text: string, from: number): { name: string; start: number } | undefined {
  METHOD_CANDIDATE.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = METHOD_CANDIDATE.exec(text)) !== null) {
    if (match.index > from + METHOD_SEARCH_WINDOW) {
      return undefined;
    }
    let k = match.index - 1;
    while (k >= 0 && /\s/.test(text[k])) {
      k--;
    }
    if (k >= 0 && (text[k] === '@' || text[k] === '.')) {
      // another annotation (`@Test(...)`) or a qualified call — skip its
      // argument list so we don't match identifiers inside it.
      const close = findMatchingParen(text, match.index + match[0].length);
      if (close > 0) {
        METHOD_CANDIDATE.lastIndex = close + 1;
      }
      continue;
    }
    if (NON_METHOD_KEYWORDS.has(match[1])) {
      continue;
    }
    return { name: match[1], start: match.index };
  }
  return undefined;
}

/**
 * The offset of the `)` closing the group opened just before [from].
 * String and char literals and comments are skipped. Returns -1 if unbalanced.
 */
function findMatchingParen(text: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i++;
      while (i < text.length && text[i] !== ch) {
        i += text[i] === '\\' ? 2 : 1;
      }
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

function unescapeJava(literal: string): string {
  return literal.replace(/\\(.)/g, '$1');
}
