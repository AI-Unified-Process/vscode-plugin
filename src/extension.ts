import * as vscode from 'vscode';
import { SpecDiagnostics } from './diagnostics';
import { DiagramViewProvider } from './diagramView';
import { PlantUmlPreviewManager } from './plantumlPreview';
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
  const plantUmlPreviews = new PlantUmlPreviewManager(context.extensionUri, context.globalState);

  /** The `.puml` file a preview command applies to: its argument, else the active editor. */
  const plantUmlTarget = (uri?: vscode.Uri): vscode.Uri | undefined =>
    uri ?? PlantUmlPreviewManager.activeSource()?.uri;

  const java = { language: 'java', scheme: 'file' };
  const markdown = { language: 'markdown', scheme: 'file' };
  const javaNavigation = new JavaUseCaseNavigationProvider(index);
  const specNavigation = new SpecNavigationProvider(index);

  context.subscriptions.push(
    index,
    diagnostics,
    diagramView,
    plantUmlPreviews,
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
    vscode.commands.registerCommand('aiup.previewPlantUml', (uri?: vscode.Uri) => {
      const target = plantUmlTarget(uri);
      if (!target) {
        void vscode.window.showInformationMessage('Open a PlantUML file (.puml) to preview it.');
        return;
      }
      plantUmlPreviews.show(target);
    }),
    vscode.commands.registerCommand('aiup.refreshPlantUmlPreview', (uri?: vscode.Uri) => {
      const target = plantUmlTarget(uri);
      if (target) {
        plantUmlPreviews.refresh(target);
      }
    }),
    vscode.window.registerWebviewPanelSerializer(PlantUmlPreviewManager.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
        const uri = (state as { uri?: string } | undefined)?.uri;
        if (!uri) {
          panel.dispose();
          return;
        }
        plantUmlPreviews.restore(panel, vscode.Uri.parse(uri));
      },
    }),
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
