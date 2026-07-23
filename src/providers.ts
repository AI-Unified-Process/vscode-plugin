import * as vscode from 'vscode';
import { classifySpecLine, SpecSite } from './core/specSites';
import { scanJavaSource, JavaUseCaseAnnotation } from './core/javaScan';
import { TestClassRef, TestMethodRef, WorkspaceIndex } from './workspaceIndex';

/** A navigation target with the labels shown in the picker. */
export interface NavigationTarget {
  location: vscode.Location;
  label: string;
  description?: string;
}

export const OPEN_LOCATIONS_COMMAND = 'aiup.openLocations';

/**
 * Opens a single target directly, or shows a quick pick when the site has
 * several targets — the VS Code equivalent of the gutter-icon popup.
 */
export async function openLocations(targets: NavigationTarget[], title: string): Promise<void> {
  if (targets.length === 0) {
    return;
  }
  if (targets.length === 1) {
    await openTarget(targets[0].location);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    targets.map((target) => ({
      label: target.label,
      description: target.description,
      target,
    })),
    { title },
  );
  if (picked) {
    await openTarget(picked.target.location);
  }
}

async function openTarget(location: vscode.Location): Promise<void> {
  await vscode.window.showTextDocument(location.uri, {
    selection: location.range,
    preserveFocus: false,
  });
}

function methodTargets(methods: TestMethodRef[]): NavigationTarget[] {
  return methods.map((method) => ({
    location: method.location,
    label: method.annotation.scenario
      ? `${method.annotation.methodName ?? '(method)'} — ${method.annotation.scenario}`
      : (method.annotation.methodName ?? '(method)'),
    description: method.className,
  }));
}

function classTargets(classes: TestClassRef[]): NavigationTarget[] {
  return classes.map((cls) => ({ location: cls.location, label: cls.className }));
}

function specTargets(locations: vscode.Location[]): NavigationTarget[] {
  return locations.map((location) => ({
    location,
    label: `${basename(location.uri)}:${location.range.start.line + 1}`,
  }));
}

function basename(uri: vscode.Uri): string {
  return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}

function countLabel(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

// ---- markdown side --------------------------------------------------------

/**
 * Resolves the targets for one spec line, shared by the CodeLens, Definition
 * and Reference providers so all three stay in sync with the IntelliJ
 * plugin's gutter icons.
 */
function specSiteTargets(
  index: WorkspaceIndex,
  documentUri: vscode.Uri,
  site: SpecSite,
): { targets: NavigationTarget[]; title: string } | undefined {
  switch (site.kind) {
    case 'useCaseId': {
      const tests = index.testMethodsFor(site.id);
      return { targets: methodTargets(tests), title: `Tests for ${site.id}` };
    }
    case 'businessRule': {
      const useCaseId = index.declaredUseCaseId(documentUri);
      if (!useCaseId) {
        return undefined;
      }
      const tests = index.testMethodsForBusinessRule(useCaseId, site.brId);
      return { targets: methodTargets(tests), title: `Tests for ${site.brId}` };
    }
    case 'title': {
      const useCaseId = index.declaredUseCaseId(documentUri);
      if (!useCaseId) {
        return undefined;
      }
      return {
        targets: classTargets(index.testClassesFor(useCaseId)),
        title: `Test class for ${useCaseId}`,
      };
    }
    case 'mainScenario': {
      const useCaseId = index.declaredUseCaseId(documentUri);
      if (!useCaseId) {
        return undefined;
      }
      const tests = index.testMethodsForMainScenario(useCaseId);
      return { targets: methodTargets(tests), title: 'Tests for Main Success Scenario' };
    }
    case 'altFlow': {
      const useCaseId = index.declaredUseCaseId(documentUri);
      if (!useCaseId) {
        return undefined;
      }
      const tests = index.testMethodsForScenario(useCaseId, site.code);
      return { targets: methodTargets(tests), title: `Tests for ${site.code}` };
    }
  }
}

export class SpecCodeLensProvider implements vscode.CodeLensProvider {
  readonly onDidChangeCodeLenses: vscode.Event<void>;

  constructor(private readonly index: WorkspaceIndex) {
    this.onDidChangeCodeLenses = index.onDidChange;
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    await this.index.ensureReady();
    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const site = classifySpecLine(document.lineAt(line).text);
      if (!site) {
        continue;
      }
      const resolved = specSiteTargets(this.index, document.uri, site);
      if (!resolved || resolved.targets.length === 0) {
        continue;
      }
      const title =
        site.kind === 'title'
          ? resolved.targets.length === 1
            ? `Test class: ${resolved.targets[0].label}`
            : countLabel(resolved.targets.length, 'test class')
          : countLabel(resolved.targets.length, 'test method');
      lenses.push(
        new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
          title,
          command: OPEN_LOCATIONS_COMMAND,
          arguments: [resolved.targets, resolved.title],
        }),
      );
    }
    return lenses;
  }
}

export class SpecNavigationProvider implements vscode.DefinitionProvider, vscode.ReferenceProvider {
  constructor(private readonly index: WorkspaceIndex) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    return this.targetsAt(document, position);
  }

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    return this.targetsAt(document, position);
  }

  private async targetsAt(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    await this.index.ensureReady();
    const site = classifySpecLine(document.lineAt(position.line).text);
    if (!site) {
      return [];
    }
    const resolved = specSiteTargets(this.index, document.uri, site);
    return resolved ? resolved.targets.map((target) => target.location) : [];
  }
}

// ---- java side ------------------------------------------------------------

function annotationsIn(document: vscode.TextDocument): JavaUseCaseAnnotation[] {
  return scanJavaSource(document.getText()).annotations;
}

export class JavaUseCaseCodeLensProvider implements vscode.CodeLensProvider {
  readonly onDidChangeCodeLenses: vscode.Event<void>;

  constructor(private readonly index: WorkspaceIndex) {
    this.onDidChangeCodeLenses = index.onDidChange;
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    await this.index.ensureReady();
    const lenses: vscode.CodeLens[] = [];
    for (const annotation of annotationsIn(document)) {
      if (!annotation.id) {
        continue;
      }
      const targets = this.index.specTargetsForAnnotation(annotation);
      if (targets.length === 0) {
        continue;
      }
      const position = document.positionAt(annotation.annotationStart);
      const title =
        targets.length === 1
          ? `Spec: ${annotation.id}`
          : `Spec: ${annotation.id} (${targets.length} targets)`;
      lenses.push(
        new vscode.CodeLens(new vscode.Range(position, position), {
          title,
          command: OPEN_LOCATIONS_COMMAND,
          arguments: [specTargets(targets), `Spec for ${annotation.id}`],
        }),
      );
    }
    return lenses;
  }
}

export class JavaUseCaseNavigationProvider
  implements vscode.DefinitionProvider, vscode.ReferenceProvider
{
  constructor(private readonly index: WorkspaceIndex) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    return this.targetsAt(document, position);
  }

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    return this.targetsAt(document, position);
  }

  private async targetsAt(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[]> {
    await this.index.ensureReady();
    const offset = document.offsetAt(position);
    for (const annotation of annotationsIn(document)) {
      if (offset < annotation.annotationStart || offset > annotation.annotationEnd) {
        continue;
      }
      if (!annotation.id) {
        return [];
      }
      // On a string inside businessRules = {...} — the matching BR heading.
      for (const rule of annotation.businessRules) {
        if (offset >= rule.start - 1 && offset <= rule.end + 1) {
          const target = this.index.businessRuleLocation(annotation.id, rule.value);
          return target ? [target] : [];
        }
      }
      // Anywhere else on the annotation — the spec leaves.
      return this.index.specTargetsForAnnotation(annotation);
    }
    return [];
  }
}
