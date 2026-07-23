import * as vscode from 'vscode';
import {
  escapeRegExp,
  fileNameMatchesUseCase,
  findDeclaredUseCaseId,
  isMainScenarioLabel,
  isSpecFileName,
  MAIN_SCENARIO_HEADING,
  scenarioPrefix,
} from './core/patterns';
import { JavaScanResult, JavaUseCaseAnnotation, scanJavaSource } from './core/javaScan';
import { computeLineStarts, offsetToPosition } from './core/textPos';

interface SpecFileEntry {
  uri: vscode.Uri;
  nameWithoutExtension: string;
  content: string;
  declaredId?: string;
}

interface JavaFileEntry {
  uri: vscode.Uri;
  scan: JavaScanResult;
  lineStarts: number[];
}

/** A `@UseCase`-annotated test method, with everything needed to navigate to it. */
export interface TestMethodRef {
  uri: vscode.Uri;
  annotation: JavaUseCaseAnnotation;
  className?: string;
  location: vscode.Location;
  idRange: vscode.Range;
}

export interface TestClassRef {
  uri: vscode.Uri;
  className: string;
  location: vscode.Location;
}

/**
 * In-memory index of the workspace's Markdown Use Case specs and
 * `@UseCase`-annotated Java files. Mirrors the IntelliJ plugin's
 * `UseCaseIndex`; for typical AIUP repos the full scan is fast because the
 * spec folder is small, so all lookups run against cached file contents.
 */
export class WorkspaceIndex implements vscode.Disposable {
  private readonly specs = new Map<string, SpecFileEntry>();
  private readonly javas = new Map<string, JavaFileEntry>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private changeTimer: NodeJS.Timeout | undefined;
  private ready: Promise<void> | undefined;

  /** Fires (debounced) after any indexed file changes. */
  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{md,java}');
    watcher.onDidCreate((uri) => void this.refreshFromDisk(uri));
    watcher.onDidChange((uri) => void this.refreshFromDisk(uri));
    watcher.onDidDelete((uri) => this.remove(uri));
    this.disposables.push(
      watcher,
      vscode.workspace.onDidChangeTextDocument((event) => this.refreshFromDocument(event.document)),
      vscode.workspace.onDidOpenTextDocument((document) => this.refreshFromDocument(document)),
    );
  }

  ensureReady(): Promise<void> {
    this.ready ??= this.scanWorkspace();
    return this.ready;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.changeEmitter.dispose();
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
    }
  }

  private async scanWorkspace(): Promise<void> {
    const [mdFiles, javaFiles] = await Promise.all([
      vscode.workspace.findFiles('**/*.md'),
      vscode.workspace.findFiles('**/*.java'),
    ]);
    await Promise.all([
      ...mdFiles.map((uri) => this.refreshFromDisk(uri, false)),
      ...javaFiles.map((uri) => this.refreshFromDisk(uri, false)),
    ]);
    // Dirty editors win over disk state.
    for (const document of vscode.workspace.textDocuments) {
      this.refreshFromDocument(document, false);
    }
    this.fireChanged();
  }

  private async refreshFromDisk(uri: vscode.Uri, notify = true): Promise<void> {
    const open = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === uri.toString() && d.isDirty,
    );
    if (open) {
      return; // the buffer is ahead of the disk
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      this.remove(uri);
      return;
    }
    this.update(uri, text, notify);
  }

  private refreshFromDocument(document: vscode.TextDocument, notify = true): void {
    if (document.uri.scheme !== 'file') {
      return;
    }
    this.update(document.uri, document.getText(), notify);
  }

  private update(uri: vscode.Uri, text: string, notify: boolean): void {
    const path = uri.path;
    if (path.endsWith('.md')) {
      const fileName = path.slice(path.lastIndexOf('/') + 1);
      this.specs.set(uri.toString(), {
        uri,
        nameWithoutExtension: fileName.replace(/\.md$/, ''),
        content: text,
        declaredId: findDeclaredUseCaseId(text),
      });
    } else if (path.endsWith('.java')) {
      this.javas.set(uri.toString(), {
        uri,
        scan: scanJavaSource(text),
        lineStarts: computeLineStarts(text),
      });
    } else {
      return;
    }
    if (notify) {
      this.fireChanged();
    }
  }

  private remove(uri: vscode.Uri): void {
    const key = uri.toString();
    if (this.specs.delete(key) || this.javas.delete(key)) {
      this.fireChanged();
    }
  }

  private fireChanged(): void {
    if (this.changeTimer) {
      clearTimeout(this.changeTimer);
    }
    this.changeTimer = setTimeout(() => this.changeEmitter.fire(), 250);
  }

  // ---- spec queries -------------------------------------------------------

  /** All Markdown files declaring the given Use Case ID (by name or body). */
  specFilesFor(useCaseId: string): SpecFileEntry[] {
    const result: SpecFileEntry[] = [];
    for (const entry of this.specs.values()) {
      if (
        fileNameMatchesUseCase(entry.nameWithoutExtension, useCaseId) ||
        entry.declaredId === useCaseId
      ) {
        result.push(entry);
      }
    }
    return result;
  }

  declaredUseCaseId(uri: vscode.Uri): string | undefined {
    return this.specs.get(uri.toString())?.declaredId;
  }

  hasAnyUseCaseSpec(): boolean {
    for (const entry of this.specs.values()) {
      if (isSpecFileName(entry.nameWithoutExtension) || entry.declaredId !== undefined) {
        return true;
      }
    }
    return false;
  }

  hasUseCaseAnnotationType(): boolean {
    for (const entry of this.javas.values()) {
      if (entry.scan.hasAnnotationType) {
        return true;
      }
    }
    return false;
  }

  /**
   * The location in the spec(s) of the scenario heading: the main-scenario
   * heading when [scenarioCode] is undefined, else the `### A1: …` /
   * `### 3a. …` heading with that code.
   */
  scenarioLocation(useCaseId: string, scenarioCode: string | undefined): vscode.Location | undefined {
    const pattern =
      scenarioCode === undefined
        ? MAIN_SCENARIO_HEADING
        : new RegExp(`^#{1,6}\\s+${escapeRegExp(scenarioCode)}\\b`, 'i');
    return this.findSpecLine(useCaseId, pattern);
  }

  /** The location of a `### BR-XXX` heading or `- **GR-XXX:** …` bullet. */
  businessRuleLocation(useCaseId: string, businessRuleId: string): vscode.Location | undefined {
    const pattern = new RegExp(`^(?:#{1,6}\\s+|\\s*[-*]\\s+\\*\\*)${escapeRegExp(businessRuleId)}\\b`);
    return this.findSpecLine(useCaseId, pattern);
  }

  /**
   * The spec locations an `@UseCase` annotation "points at": the scenario
   * heading plus one location per business rule. Falls back to the top of the
   * spec file when no heading matches.
   */
  specTargetsForAnnotation(annotation: JavaUseCaseAnnotation): vscode.Location[] {
    const useCaseId = annotation.id;
    if (!useCaseId) {
      return [];
    }
    const scenario = annotation.scenario;
    const scenarioCode =
      scenario && scenario.trim() !== '' && !isMainScenarioLabel(scenario)
        ? scenarioPrefix(scenario)
        : undefined;

    const targets: vscode.Location[] = [];
    const scenarioTarget = this.scenarioLocation(useCaseId, scenarioCode);
    if (scenarioTarget) {
      targets.push(scenarioTarget);
    }
    for (const rule of annotation.businessRules) {
      const target = this.businessRuleLocation(useCaseId, rule.value);
      if (target) {
        targets.push(target);
      }
    }
    if (targets.length === 0) {
      for (const spec of this.specFilesFor(useCaseId)) {
        targets.push(new vscode.Location(spec.uri, new vscode.Position(0, 0)));
      }
    }
    return dedupeLocations(targets);
  }

  private findSpecLine(useCaseId: string, pattern: RegExp): vscode.Location | undefined {
    for (const spec of this.specFilesFor(useCaseId)) {
      const lines = spec.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i].replace(/\r$/, ''))) {
          return new vscode.Location(spec.uri, new vscode.Position(i, 0));
        }
      }
    }
    return undefined;
  }

  // ---- test method queries ------------------------------------------------

  /** All test methods annotated with `@UseCase(id = useCaseId)`. */
  testMethodsFor(useCaseId: string): TestMethodRef[] {
    return this.testMethodsMatching(useCaseId, () => true);
  }

  /**
   * Test methods for the Main Success Scenario of a UC: those whose `scenario`
   * attribute is missing, blank, one of the accepted main-flow labels, or not
   * an alternative-flow code.
   */
  testMethodsForMainScenario(useCaseId: string): TestMethodRef[] {
    return this.testMethodsMatching(useCaseId, (annotation) => {
      const scenario = annotation.scenario;
      return (
        !scenario ||
        scenario.trim() === '' ||
        isMainScenarioLabel(scenario) ||
        scenarioPrefix(scenario) === undefined
      );
    });
  }

  /** Test methods whose `scenario` attribute starts with the given code (`A1`, `3a`). */
  testMethodsForScenario(useCaseId: string, scenarioCode: string): TestMethodRef[] {
    return this.testMethodsMatching(useCaseId, (annotation) => {
      const scenario = annotation.scenario;
      if (!scenario) {
        return false;
      }
      return scenarioPrefix(scenario)?.toLowerCase() === scenarioCode.toLowerCase();
    });
  }

  /**
   * Test methods scoped to a specific Use Case that reference the given
   * Business Rule ID via the `businessRules` attribute. BR ids are only unique
   * within a Use Case, so callers must disambiguate by UC.
   */
  testMethodsForBusinessRule(useCaseId: string, businessRuleId: string): TestMethodRef[] {
    return this.testMethodsMatching(useCaseId, (annotation) =>
      annotation.businessRules.some((rule) => rule.value === businessRuleId),
    );
  }

  /** Distinct test classes containing at least one `@UseCase(id = useCaseId)` method. */
  testClassesFor(useCaseId: string): TestClassRef[] {
    const byKey = new Map<string, TestClassRef>();
    for (const entry of this.javas.values()) {
      if (!entry.scan.className) {
        continue;
      }
      if (!entry.scan.annotations.some((annotation) => annotation.id === useCaseId)) {
        continue;
      }
      const position = toPosition(entry, entry.scan.classNameStart);
      byKey.set(entry.uri.toString(), {
        uri: entry.uri,
        className: entry.scan.className,
        location: new vscode.Location(entry.uri, position),
      });
    }
    return [...byKey.values()];
  }

  /** The scan result for a Java file, if it is indexed. */
  javaScanFor(uri: vscode.Uri): { scan: JavaScanResult; lineStarts: number[] } | undefined {
    return this.javas.get(uri.toString());
  }

  /** All indexed Java files (for workspace-wide diagnostics). */
  allJavaFiles(): { uri: vscode.Uri; scan: JavaScanResult; lineStarts: number[] }[] {
    return [...this.javas.values()];
  }

  private testMethodsMatching(
    useCaseId: string,
    extra: (annotation: JavaUseCaseAnnotation) => boolean,
  ): TestMethodRef[] {
    const result: TestMethodRef[] = [];
    for (const entry of this.javas.values()) {
      for (const annotation of entry.scan.annotations) {
        if (annotation.id !== useCaseId || !extra(annotation)) {
          continue;
        }
        result.push({
          uri: entry.uri,
          annotation,
          className: entry.scan.className,
          location: new vscode.Location(entry.uri, toPosition(entry, annotation.methodNameStart)),
          idRange: new vscode.Range(
            toPosition(entry, annotation.idStart),
            toPosition(entry, annotation.idEnd),
          ),
        });
      }
    }
    return result;
  }
}

function toPosition(entry: { lineStarts: number[] }, offset: number): vscode.Position {
  const { line, character } = offsetToPosition(entry.lineStarts, offset);
  return new vscode.Position(line, character);
}

function dedupeLocations(locations: vscode.Location[]): vscode.Location[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = `${location.uri.toString()}:${location.range.start.line}:${location.range.start.character}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}
