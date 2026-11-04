import { describe, expect, it } from 'vitest';
import {
  commentSyntaxFor,
  isIgnoredPath,
  isTestSourcePath,
  scanUseCaseMarkers,
} from './commentScan';

function markers(fileName: string, text: string) {
  return scanUseCaseMarkers(text, commentSyntaxFor(fileName)!);
}

function references(fileName: string, text: string) {
  return markers(fileName, text).map((marker) => marker.reference);
}

describe('scanUseCaseMarkers', () => {
  it('finds line comments, also behind code', () => {
    expect(references('Impl.java', '// UC-002 BR-001: Rows load lazily.\nclass Impl {}\n')).toEqual([
      { useCaseId: 'UC-002', qualifier: 'BR-001' },
    ]);
    expect(references('Impl.java', 'int a = 1; // UC-010 A2: Error view.\n')).toEqual([
      { useCaseId: 'UC-010', qualifier: 'A2' },
    ]);
  });

  it('finds Javadoc lines with their offsets and text', () => {
    const text = '/**\n * Some class.\n * UC-002 BR-001: Rows load lazily.\n */\nclass Impl {}\n';
    const [marker] = markers('Impl.java', text);
    expect(text.slice(marker.start, marker.end)).toBe('UC-002 BR-001');
    expect(marker.text).toBe('UC-002 BR-001: Rows load lazily.');
  });

  it('works in other languages', () => {
    const expected = [{ useCaseId: 'UC-002', qualifier: 'BR-001' }];
    expect(references('V1__init.sql', '-- UC-002 BR-001: Unique.\n')).toEqual(expected);
    expect(references('view.xml', '<!-- UC-002 BR-001: Lazy. -->\n<a/>\n')).toEqual(expected);
    expect(references('view.html', '<!-- UC-002 BR-001: Lazy. -->\n')).toEqual(expected);
    expect(references('view.ts', 'const a = 1; // UC-002 BR-001: Lazy.\n')).toEqual(expected);
    expect(references('job.py', '# UC-002 BR-001: Lazy.\n')).toEqual(expected);
    expect(references('app.yml', '# UC-002 BR-001: Lazy.\n')).toEqual(expected);
    expect(references('View.vue', '<!-- UC-002 BR-001: Lazy. -->\n')).toEqual(expected);
    expect(references('Page.razor', '@* UC-002 BR-001: Lazy. *@\n')).toEqual(expected);
  });

  it('strips the delimiters of the shown text', () => {
    expect(markers('view.xml', '<!-- UC-002 BR-001: Lazy. -->')[0].text).toBe('UC-002 BR-001: Lazy.');
    expect(markers('a.sql', '-- UC-002: Table.\r\n')[0].text).toBe('UC-002: Table.');
  });

  it('ignores references outside comments', () => {
    expect(markers('Impl.java', 'static final String ID = "UC-002";\n')).toEqual([]);
    expect(markers('Impl.java', 'String url = "http://x // UC-002";\n')).toEqual([]);
    expect(markers('Impl.java', 'String s = """\n  // UC-002\n  """;\n')).toEqual([]);
    expect(markers('view.ts', 'const s = `\n// UC-002\n`;\n')).toEqual([]);
    expect(markers('a.sql', "SELECT '-- UC-002';\n")).toEqual([]);
    expect(markers('view.html', '<p>UC-002</p>\n')).toEqual([]);
  });

  it('survives a stray apostrophe or an escaped quote', () => {
    expect(references('view.html', "<p>it's</p>\n<!-- UC-002 -->\n")).toEqual([{ useCaseId: 'UC-002' }]);
    expect(references('app.yml', "key: it's # UC-002\n")).toEqual([{ useCaseId: 'UC-002' }]);
    expect(references('Impl.java', 'char c = \'"\'; // UC-002\n')).toEqual([{ useCaseId: 'UC-002' }]);
    expect(references('Impl.java', 'String s = "a\\"b"; // UC-002\n')).toEqual([{ useCaseId: 'UC-002' }]);
    expect(references('job.sh', "echo don't\n# UC-002\n")).toEqual([{ useCaseId: 'UC-002' }]);
  });

  it('reads an unterminated block comment to the end', () => {
    expect(references('Impl.java', '/* UC-002\n')).toEqual([{ useCaseId: 'UC-002' }]);
  });
});

describe('commentSyntaxFor', () => {
  it('knows code files, not Markdown', () => {
    expect(commentSyntaxFor('Impl.JAVA')).toBeDefined();
    expect(commentSyntaxFor('UC-002-vets.md')).toBeUndefined();
    expect(commentSyntaxFor('Makefile')).toBeUndefined();
  });
});

describe('isTestSourcePath', () => {
  it('recognizes test roots and test file names', () => {
    expect(isTestSourcePath('src/test/java/VetView.java')).toBe(true);
    expect(isTestSourcePath('module/src/test/java/VetView.java')).toBe(true);
    expect(isTestSourcePath('tests/view.py')).toBe(true);
    expect(isTestSourcePath('src/app/__tests__/view.ts')).toBe(true);
    expect(isTestSourcePath('src/main/java/VetViewTest.java')).toBe(true);
    expect(isTestSourcePath('src/main/java/VetViewIT.java')).toBe(true);
    expect(isTestSourcePath('src/app/vet.component.spec.ts')).toBe(true);
    expect(isTestSourcePath('src/app/vet.test.tsx')).toBe(true);
    expect(isTestSourcePath('pkg/vet_test.go')).toBe(true);
    expect(isTestSourcePath('app/test_vet.py')).toBe(true);
  });

  it('keeps implementation sources', () => {
    expect(isTestSourcePath('src/main/java/VetView.java')).toBe(false);
    expect(isTestSourcePath('src/main/java/Contest.java')).toBe(false);
    expect(isTestSourcePath('src/main/java/AUDIT.java')).toBe(false);
    expect(isTestSourcePath('src/main/resources/latest/view.xml')).toBe(false);
  });
});

describe('isIgnoredPath', () => {
  it('skips dependencies and build output', () => {
    expect(isIgnoredPath('node_modules/a/index.js')).toBe(true);
    expect(isIgnoredPath('web/node_modules/a/index.js')).toBe(true);
    expect(isIgnoredPath('target/generated-sources/A.java')).toBe(true);
    expect(isIgnoredPath('src/main/java/target/Target.java')).toBe(true);
    expect(isIgnoredPath('src/main/java/View.java')).toBe(false);
    expect(isIgnoredPath('src/main/java/.gitkeep')).toBe(false);
  });
});
