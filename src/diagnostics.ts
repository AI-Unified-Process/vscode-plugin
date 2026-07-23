import * as vscode from 'vscode';
import { offsetToPosition } from './core/textPos';
import { WorkspaceIndex } from './workspaceIndex';

/**
 * The VS Code port of the IntelliJ "Use Case ID has no matching spec"
 * inspection: every `@UseCase(id = "UC-XXX")` whose ID has no spec file in
 * the workspace gets a warning on the id literal.
 */
export class SpecDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('aiup');
  private readonly subscription: vscode.Disposable;

  constructor(private readonly index: WorkspaceIndex) {
    this.subscription = index.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.collection.clear();
    for (const file of this.index.allJavaFiles()) {
      const diagnostics: vscode.Diagnostic[] = [];
      for (const annotation of file.scan.annotations) {
        if (!annotation.id || this.index.specFilesFor(annotation.id).length > 0) {
          continue;
        }
        const start = offsetToPosition(file.lineStarts, annotation.idStart);
        const end = offsetToPosition(file.lineStarts, annotation.idEnd);
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(start.line, start.character, end.line, end.character),
          `Use Case ID '${annotation.id}' has no matching spec file`,
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = 'aiup';
        diagnostic.code = 'use-case-id-without-spec';
        diagnostics.push(diagnostic);
      }
      if (diagnostics.length > 0) {
        this.collection.set(file.uri, diagnostics);
      }
    }
  }

  dispose(): void {
    this.subscription.dispose();
    this.collection.dispose();
  }
}
