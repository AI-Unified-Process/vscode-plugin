import * as path from 'node:path';
import * as vscode from 'vscode';
import type { WorkspaceIndex } from './workspaceIndex';

const VIEW_TYPE = 'aiup.bpmnEditor';
const TEXT_SYNC_DELAY_MS = 300;

type ExportFormat = 'svg' | 'png';

type Inbound =
  | { type: 'ready' }
  | { type: 'changed'; xml: string }
  | { type: 'openUseCase'; id: string }
  | { type: 'exported'; id: number; data: string }
  | { type: 'exportFailed'; id: number; message: string };

/**
 * Opens `*.bpmn` files in the BPMN editor of the AI Unified Process Studio (the bpmn-js
 * modeler with the properties panel), as in the IntelliJ plugin. The diagram and the text
 * editor ("Reopen Editor With… → Text Editor") share the text document: an edit in the
 * diagram replaces the document text, an edit of the text is imported into the diagram
 * (debounced). Opening a file imports it unchanged, so it is never dirty until the user
 * edits it. An activity named after a use case (`UC-004 Find Owners`) opens its spec
 * from the diagram. The editor runs from files bundled with the extension; nothing is
 * loaded from the network.
 */
export class BpmnEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = VIEW_TYPE;

  private readonly editors = new Set<BpmnEditor>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index: WorkspaceIndex,
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const editor = new BpmnEditor(document, panel, this.extensionUri, this.index);
    this.editors.add(editor);
    panel.onDidDispose(() => this.editors.delete(editor));
  }

  /** Exports the diagram of the active BPMN editor, unsaved edits included. */
  async exportActive(format: ExportFormat): Promise<void> {
    const editor = [...this.editors].find((candidate) => candidate.active);
    if (!editor) {
      void vscode.window.showInformationMessage('Open a BPMN file (.bpmn) in the BPMN editor to export it.');
      return;
    }
    await editor.export(format);
  }
}

class BpmnEditor {
  private readonly disposables: vscode.Disposable[] = [];
  /** The XML the diagram shows, so neither side echoes a change back to its origin. */
  private syncedText: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private nextExportId = 0;
  private readonly pendingExports = new Map<number, (result: { data?: string; message?: string }) => void>();

  constructor(
    private readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly index: WorkspaceIndex,
  ) {
    const media = vscode.Uri.joinPath(extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = html(panel.webview, media);
    panel.webview.onDidReceiveMessage((message: Inbound) => this.onMessage(message), undefined, this.disposables);
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (event.document.uri.toString() === document.uri.toString() && event.contentChanges.length > 0) {
          this.schedulePush();
        }
      },
      undefined,
      this.disposables,
    );
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  get active(): boolean {
    return this.panel.active;
  }

  async export(format: ExportFormat): Promise<void> {
    const source = this.document.uri;
    const target = await vscode.window.showSaveDialog({
      title: 'Export BPMN Diagram',
      defaultUri: source.with({ path: source.path.replace(/\.bpmn$/i, '') + `.${format}` }),
      filters: { [format.toUpperCase()]: [format] },
    });
    if (!target) return;
    const id = this.nextExportId++;
    const result = await new Promise<{ data?: string; message?: string }>((resolve) => {
      this.pendingExports.set(id, resolve);
      void this.panel.webview.postMessage({ type: 'export', id, format });
    });
    if (result.data === undefined) {
      void vscode.window.showErrorMessage(`The BPMN diagram could not be exported: ${result.message}`);
      return;
    }
    const content = format === 'svg' ? Buffer.from(result.data, 'utf8') : Buffer.from(result.data, 'base64');
    try {
      await vscode.workspace.fs.writeFile(target, content);
      void vscode.window.showInformationMessage(`Exported the BPMN diagram to ${path.basename(target.fsPath)}.`);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `The BPMN diagram could not be written to ${target.fsPath}: ${(error as Error).message}`,
      );
    }
  }

  private onMessage(message: Inbound): void {
    switch (message?.type) {
      case 'ready': {
        this.syncedText = this.document.getText();
        const readOnly = vscode.workspace.fs.isWritableFileSystem(this.document.uri.scheme) === false;
        void this.panel.webview.postMessage({ type: 'init', xml: this.syncedText, readOnly });
        break;
      }
      case 'changed':
        void this.applyDiagramEdit(message.xml);
        break;
      case 'openUseCase':
        void this.openUseCase(message.id);
        break;
      case 'exported':
        this.pendingExports.get(message.id)?.({ data: message.data });
        this.pendingExports.delete(message.id);
        break;
      case 'exportFailed':
        this.pendingExports.get(message.id)?.({ message: message.message });
        this.pendingExports.delete(message.id);
        break;
    }
  }

  /** Opens the spec of the use case, lets the user choose between several, or reports that there is none. */
  private async openUseCase(useCaseId: string): Promise<void> {
    await this.index.ensureReady();
    const specs = this.index
      .specFilesFor(useCaseId)
      .map((spec) => spec.uri)
      .sort((a, b) => a.path.localeCompare(b.path));
    if (specs.length === 0) {
      void vscode.window.showWarningMessage(`No specification found for use case ${useCaseId}.`);
      return;
    }
    let target = specs[0];
    if (specs.length > 1) {
      const choice = await vscode.window.showQuickPick(
        specs.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
        { title: `Specifications of ${useCaseId}` },
      );
      if (!choice) return;
      target = choice.uri;
    }
    await vscode.window.showTextDocument(target, { preview: false });
  }

  private async applyDiagramEdit(xml: string): Promise<void> {
    this.syncedText = xml;
    if (this.document.getText() === xml) return;
    const edit = new vscode.WorkspaceEdit();
    const all = new vscode.Range(0, 0, this.document.lineCount, 0);
    edit.replace(this.document.uri, all, xml);
    await vscode.workspace.applyEdit(edit);
  }

  private schedulePush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pushDocument(), TEXT_SYNC_DELAY_MS);
  }

  private pushDocument(): void {
    const text = this.document.getText();
    // before the webview is ready it reads the document itself
    if (this.syncedText === undefined || text === this.syncedText) return;
    this.syncedText = text;
    void this.panel.webview.postMessage({ type: 'setXml', xml: text });
  }

  private dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.pendingExports.forEach((resolve) => resolve({ message: 'The editor was closed.' }));
    this.pendingExports.clear();
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}

function nonce(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 32 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function html(webview: vscode.Webview, media: vscode.Uri): string {
  const id = nonce();
  const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'bpmn-editor.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'bpmn-editor.css'));
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${id}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:;">
  <link rel="stylesheet" href="${style}">
  <title>BPMN Editor</title>
</head>
<body>
  <div id="root">
    <div id="error" hidden></div>
    <div id="main"><div id="canvas"></div><div id="properties"></div></div>
  </div>
  <script nonce="${id}" src="${script}"></script>
</body>
</html>`;
}
