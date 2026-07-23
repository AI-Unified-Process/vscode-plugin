import * as vscode from 'vscode';
import { generateMermaid, generatePlantUml, parse } from './core/activityDiagram';

/**
 * The AIUP Diagram view: a live activity diagram of the Use Case spec in the
 * active editor. The main flow forms the numbered spine, every Alternative
 * Flow branches at the step its trigger references and rejoins the flow after
 * its own steps. Rendered locally with a bundled Mermaid build — no external
 * rendering service, the spec content never leaves the editor.
 */
export class DiagramViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'aiup.diagram';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private updateTimer: NodeJS.Timeout | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          this.scheduleUpdate();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.postState()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'ready') {
        this.postState();
      }
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.postState();
      }
    });
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
  }

  /** The PlantUML source of the active editor's spec, for the copy command. */
  activePlantUml(): string | undefined {
    const document = this.activeMarkdown();
    if (!document) {
      return undefined;
    }
    return generatePlantUml(parse(document.getText()));
  }

  private scheduleUpdate(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    this.updateTimer = setTimeout(() => this.postState(), 400);
  }

  private update(): void {
    this.postState();
  }

  private activeMarkdown(): vscode.TextDocument | undefined {
    const document = vscode.window.activeTextEditor?.document;
    return document?.languageId === 'markdown' ? document : undefined;
  }

  private postState(): void {
    if (!this.view) {
      return;
    }
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    const document = this.activeMarkdown();
    if (!document) {
      void this.view.webview.postMessage({
        type: 'empty',
        dark,
        message: 'Open a Use Case spec (Markdown) to see its activity diagram.',
      });
      return;
    }
    const source = generateMermaid(parse(document.getText()));
    if (source === '') {
      void this.view.webview.postMessage({
        type: 'empty',
        dark,
        message:
          'No Main Success Scenario steps found. Add numbered steps under ' +
          '"## Main Success Scenario" (or "## Hauptablauf").',
      });
      return;
    }
    void this.view.webview.postMessage({ type: 'diagram', dark, source });
  }

  private html(webview: vscode.Webview): string {
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mermaid.min.js'),
    );
    const nonce = Array.from({ length: 32 }, () =>
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(
        Math.floor(Math.random() * 62),
      ),
    ).join('');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource} data:;">
  <style>
    body { padding: 8px; }
    #message { color: var(--vscode-descriptionForeground); font-size: 12px; }
    #error { color: var(--vscode-errorForeground); font-size: 12px; white-space: pre-wrap; }
    #diagram svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <div id="message"></div>
  <div id="error"></div>
  <div id="diagram"></div>
  <script nonce="${nonce}" src="${mermaidUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messageEl = document.getElementById('message');
    const errorEl = document.getElementById('error');
    const diagramEl = document.getElementById('diagram');
    let renderSeq = 0;
    let currentTheme;

    function init(dark) {
      const theme = dark ? 'dark' : 'default';
      if (theme !== currentTheme) {
        currentTheme = theme;
        mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'loose' });
      }
    }

    async function render(source) {
      const seq = ++renderSeq;
      try {
        const { svg } = await mermaid.render('aiup-diagram-' + seq, source);
        if (seq !== renderSeq) return;
        diagramEl.innerHTML = svg;
        messageEl.textContent = '';
        errorEl.textContent = '';
      } catch (err) {
        if (seq !== renderSeq) return;
        diagramEl.innerHTML = '';
        errorEl.textContent = 'Could not render the diagram: ' + (err && err.message ? err.message : err);
      }
    }

    let lastSource;
    window.addEventListener('message', (event) => {
      const msg = event.data;
      init(msg.dark);
      if (msg.type === 'diagram') {
        lastSource = msg.source;
        render(msg.source);
      } else if (msg.type === 'empty') {
        lastSource = undefined;
        diagramEl.innerHTML = '';
        errorEl.textContent = '';
        messageEl.textContent = msg.message;
      } else if (lastSource) {
        render(lastSource);
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
