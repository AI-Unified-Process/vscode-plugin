import { locateUseCaseReferences, UseCaseReference } from './patterns';

/**
 * A lightweight comment scanner for the Use Case markers the implementation
 * carries instead of `@UseCase` (`// UC-XXX BR-YYY: …`, `-- UC-XXX BR-YYY: …`,
 * Javadoc lines). IntelliJ finds them through PSI comments in every language;
 * VS Code has no such API, so comments are found per file extension, skipping
 * string literals so that `"UC-002"` in code is not a marker.
 */

export interface CommentSyntax {
  line: string[];
  block: [open: string, close: string][];
  /** String delimiters, longest first. */
  strings: string[];
}

/** One line of a comment, delimiters included, and the offset of its first character. */
export interface CommentLine {
  text: string;
  start: number;
}

/** A Use Case reference in a comment, with its offsets in the file. */
export interface UseCaseMarker {
  reference: UseCaseReference;
  start: number;
  end: number;
  /** The comment line without its delimiters, as shown in a picker. */
  text: string;
}

const C_BLOCK: [string, string] = ['/*', '*/'];
const XML_BLOCK: [string, string] = ['<!--', '-->'];

const C_STYLE: CommentSyntax = { line: ['//'], block: [C_BLOCK], strings: ['"', "'"] };
const TEXT_BLOCKS: CommentSyntax = { ...C_STYLE, strings: ['"""', '"', "'"] };
const BACKTICKS: CommentSyntax = { ...C_STYLE, strings: ['"', "'", '`'] };
const SQL: CommentSyntax = { line: ['--'], block: [C_BLOCK], strings: ["'", '"'] };
const XML: CommentSyntax = { line: [], block: [XML_BLOCK], strings: [] };
const CSS: CommentSyntax = { line: [], block: [C_BLOCK], strings: ['"', "'"] };
const SINGLE_FILE_COMPONENT: CommentSyntax = { ...BACKTICKS, block: [C_BLOCK, XML_BLOCK] };
const RAZOR: CommentSyntax = { ...C_STYLE, block: [C_BLOCK, XML_BLOCK, ['@*', '*@']] };
const PYTHON: CommentSyntax = { line: ['#'], block: [], strings: ['"""', "'''", '"', "'"] };
const SHELL: CommentSyntax = { line: ['#'], block: [], strings: ['"', "'"] };
// An apostrophe in a plain YAML scalar opens no string.
const YAML: CommentSyntax = { line: ['#'], block: [], strings: ['"'] };
const PROPERTIES: CommentSyntax = { line: ['#'], block: [], strings: [] };

const SYNTAX_BY_EXTENSION: Record<string, CommentSyntax> = {
  java: TEXT_BLOCKS,
  kt: TEXT_BLOCKS,
  kts: TEXT_BLOCKS,
  groovy: TEXT_BLOCKS,
  gradle: TEXT_BLOCKS,
  scala: TEXT_BLOCKS,
  ts: BACKTICKS,
  tsx: BACKTICKS,
  js: BACKTICKS,
  jsx: BACKTICKS,
  mjs: BACKTICKS,
  cjs: BACKTICKS,
  go: BACKTICKS,
  cs: C_STYLE,
  rs: C_STYLE,
  swift: TEXT_BLOCKS,
  php: C_STYLE,
  c: C_STYLE,
  h: C_STYLE,
  cpp: C_STYLE,
  hpp: C_STYLE,
  sql: SQL,
  xml: XML,
  html: XML,
  htm: XML,
  xhtml: XML,
  css: CSS,
  scss: C_STYLE,
  less: C_STYLE,
  vue: SINGLE_FILE_COMPONENT,
  svelte: SINGLE_FILE_COMPONENT,
  razor: RAZOR,
  cshtml: RAZOR,
  py: PYTHON,
  sh: SHELL,
  bash: SHELL,
  yml: YAML,
  yaml: YAML,
  properties: PROPERTIES,
};

/** The file extensions whose comments are searched for Use Case markers. */
export const COMMENT_FILE_EXTENSIONS = Object.keys(SYNTAX_BY_EXTENSION);

/** Directories of dependencies and build output, never searched for markers. */
export const IGNORED_DIRECTORIES = [
  'node_modules',
  'target',
  'build',
  'dist',
  'out',
  'bin',
  'obj',
  'generated',
  '.git',
  '.gradle',
  '.idea',
  '.next',
  '.angular',
  '.vscode-test',
];

const IGNORED_PATH = new RegExp(
  `(?:^|/)(?:${IGNORED_DIRECTORIES.map((name) => name.replace('.', '\\.')).join('|')})/`,
);

/**
 * Test sources by directory or file name: Maven/Gradle test roots, `test/`,
 * `__tests__/`, `e2e/`, and `FooTest.java`, `FooIT.java`, `foo.spec.ts`,
 * `foo_test.go`, `test_foo.py`.
 */
const TEST_SOURCE =
  /(?:^|\/)(?:tests?|__tests__|e2e|testFixtures|integrationTest)\/|[a-z0-9](?:Tests?|IT)\.\w+$|[._-](?:test|spec)\.\w+$|(?:^|\/)test_[^/]*\.py$/;

/** The comment syntax of a file by its name; undefined if its comments aren't searched. */
export function commentSyntaxFor(fileName: string): CommentSyntax | undefined {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? undefined : SYNTAX_BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()];
}

/** True for a workspace-relative path below dependencies or build output. */
export function isIgnoredPath(relativePath: string): boolean {
  return IGNORED_PATH.test(relativePath);
}

/**
 * True for a workspace-relative path of a test source, the stand-in for
 * IntelliJ's test scope. Relative, so that a workspace below a folder named
 * `test` is not taken for tests as a whole.
 */
export function isTestSourcePath(relativePath: string): boolean {
  return TEST_SOURCE.test(relativePath);
}

export function scanComments(text: string, syntax: CommentSyntax): CommentLine[] {
  const comments: CommentLine[] = [];
  let i = 0;
  while (i < text.length) {
    const offset = i;
    if (syntax.line.some((open) => text.startsWith(open, offset))) {
      const newline = text.indexOf('\n', i);
      i = newline < 0 ? text.length : newline;
      comments.push({ text: text.slice(offset, i), start: offset });
      continue;
    }
    const block = syntax.block.find(([open]) => text.startsWith(open, offset));
    if (block) {
      const close = text.indexOf(block[1], i + block[0].length);
      i = close < 0 ? text.length : close + block[1].length;
      pushLines(comments, text, offset, i);
      continue;
    }
    const quote = syntax.strings.find((open) => text.startsWith(open, offset));
    i = quote ? skipString(text, i, quote) : i + 1;
  }
  return comments;
}

function pushLines(comments: CommentLine[], text: string, start: number, end: number): void {
  let lineStart = start;
  for (const line of text.slice(start, end).split('\n')) {
    comments.push({ text: line, start: lineStart });
    lineStart += line.length + 1;
  }
}

/**
 * The offset just past the string opened at [start]. A `"` or `'` string ends
 * at the line end at the latest, so that a stray apostrophe cannot swallow the
 * rest of the file; text blocks and backtick strings span lines.
 */
function skipString(text: string, start: number, quote: string): number {
  const spansLines = quote.length > 1 || quote === '`';
  let i = start + quote.length;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
    } else if (text.startsWith(quote, i)) {
      return i + quote.length;
    } else if (text[i] === '\n' && !spansLines) {
      return i;
    } else {
      i++;
    }
  }
  return text.length;
}

/** The Use Case markers in the comments of a source text, in file order. */
export function scanUseCaseMarkers(text: string, syntax: CommentSyntax): UseCaseMarker[] {
  if (!text.includes('UC-')) {
    return [];
  }
  return scanComments(text, syntax).flatMap((comment) =>
    locateUseCaseReferences(comment.text).map(({ reference, start, end }) => ({
      reference,
      start: comment.start + start,
      end: comment.start + end,
      text: withoutCommentDelimiters(comment.text),
    })),
  );
}

function withoutCommentDelimiters(line: string): string {
  return line.replace(/^[/*\-#<!>@\s]+/, '').replace(/[/*\-#<!>@\s]+$/, '');
}
