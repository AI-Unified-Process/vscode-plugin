import * as vscode from 'vscode';
import { SpecDiagnostics } from './diagnostics';
import { DiagramViewProvider } from './diagramView';
import {
  JavaUseCaseCodeLensProvider,
  JavaUseCaseNavigationProvider,
  NavigationTarget,
  OPEN_LOCATIONS_COMMAND,
  openLocations,
  SpecCodeLensProvider,
  SpecNavigationProvider,
} from './providers';
import { createUseCaseJava, maybeOfferScaffold } from './scaffold';
import { WorkspaceIndex } from './workspaceIndex';

export function activate(context: vscode.ExtensionContext): void {
  const index = new WorkspaceIndex();
  const diagnostics = new SpecDiagnostics(index);
  const diagramView = new DiagramViewProvider(context.extensionUri);

  const java = { language: 'java', scheme: 'file' };
  const markdown = { language: 'markdown', scheme: 'file' };
  const javaNavigation = new JavaUseCaseNavigationProvider(index);
  const specNavigation = new SpecNavigationProvider(index);

  context.subscriptions.push(
    index,
    diagnostics,
    diagramView,
    vscode.window.registerWebviewViewProvider(DiagramViewProvider.viewId, diagramView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.languages.registerCodeLensProvider(java, new JavaUseCaseCodeLensProvider(index)),
    vscode.languages.registerCodeLensProvider(markdown, new SpecCodeLensProvider(index)),
    vscode.languages.registerDefinitionProvider(java, javaNavigation),
    vscode.languages.registerReferenceProvider(java, javaNavigation),
    vscode.languages.registerDefinitionProvider(markdown, specNavigation),
    vscode.languages.registerReferenceProvider(markdown, specNavigation),
    vscode.commands.registerCommand(
      OPEN_LOCATIONS_COMMAND,
      (targets: NavigationTarget[], title: string) => openLocations(targets, title),
    ),
    vscode.commands.registerCommand('aiup.showDiagram', () =>
      vscode.commands.executeCommand('aiup.diagram.focus'),
    ),
    vscode.commands.registerCommand('aiup.createUseCaseJava', createUseCaseJava),
    vscode.commands.registerCommand('aiup.copyPlantUml', async () => {
      const source = diagramView.activePlantUml();
      if (!source) {
        void vscode.window.showInformationMessage(
          'Open a Use Case spec (Markdown) with a Main Success Scenario first.',
        );
        return;
      }
      await vscode.env.clipboard.writeText(source);
      void vscode.window.showInformationMessage('PlantUML source copied to the clipboard.');
    }),
  );

  void index.ensureReady().then(() => {
    diagnostics.refresh();
    void maybeOfferScaffold(context, index);
  });
}

export function deactivate(): void {
  // subscriptions are disposed by VS Code
}
