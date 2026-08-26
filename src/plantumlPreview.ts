import * as path from 'node:path';
import * as vscode from 'vscode';
import { splitDiagrams } from './core/plantuml';
import { PlantUmlRenderer, RenderError } from './plantumlRenderer';

const VIEW_TYPE = 'aiup.plantumlPreview';
const DEBOUNCE_MS = 400;

/**
 * The `.puml` preview: one webview panel per file, showing every `@start…`
 * block of the file as an SVG. The preview follows the editor — it re-renders
 * as you type (debounced) and on save — and is zoomable and pannable.
 */
export class PlantUmlPreviewManager implements vscode.Disposable {
  static readonly viewType = VIEW_TYPE;

  private readonly previews = new Map<string, PlantUmlPreview>();
  private readonly renderer: PlantUmlRenderer;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    memento: vscode.Memento,
  ) {
    this.renderer = new PlantUmlRenderer(memento);
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) =>
        this.previews.get(event.document.uri.toString())?.scheduleUpdate(),
      ),
      vscode.workspace.onDidSaveTextDocument((document) =>
        this.previews.get(document.uri.toString())?.update(),
      ),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('aiup.plantuml')) {
          this.previews.forEach((preview) => preview.update());
        }
      }),
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.previews.forEach((preview) => preview.dispose());
    this.previews.clear();
  }

  /** Opens (or reveals) the preview of `uri`, by default beside the editor. */
  show(uri: vscode.Uri, column = vscode.ViewColumn.Beside): void {
    const existing = this.previews.get(uri.toString());
    if (existing) {
      existing.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      previewTitle(uri),
      { viewColumn: column, preserveFocus: true },
      { ...webviewOptions(this.extensionUri), retainContextWhenHidden: true },
    );
    this.adopt(panel, uri);
  }

  /** Re-renders the preview of `uri`, ignoring the debounce. */
  refresh(uri: vscode.Uri): void {
    void this.previews.get(uri.toString())?.update();
  }

  /** Reconnects a panel restored by VS Code after a window reload. */
  restore(panel: vscode.WebviewPanel, uri: vscode.Uri): void {
    this.previews.get(uri.toString())?.dispose();
    panel.webview.options = webviewOptions(this.extensionUri);
    this.adopt(panel, uri);
  }

  /** The document of the active editor, if it is a PlantUML file. */
  static activeSource(): vscode.TextDocument | undefined {
    const document = vscode.window.activeTextEditor?.document;
    return document && isPlantUml(document) ? document : undefined;
  }

  private adopt(panel: vscode.WebviewPanel, uri: vscode.Uri): void {
    const preview = new PlantUmlPreview(panel, uri, this.renderer);
    this.previews.set(uri.toString(), preview);
    panel.onDidDispose(() => {
      if (this.previews.get(uri.toString()) === preview) {
        this.previews.delete(uri.toString());
      }
    });
  }
}

class PlantUmlPreview {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private pending: vscode.CancellationTokenSource | undefined;
  private ready = false;
  private disposed = false;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly uri: vscode.Uri,
    private readonly renderer: PlantUmlRenderer,
  ) {
    panel.title = previewTitle(uri);
    panel.webview.html = html(panel.webview, uri);
    panel.webview.onDidReceiveMessage(
      (message) => {
        if (message?.type === 'ready') {
          this.ready = true;
          void this.update();
        }
      },
      undefined,
      this.disposables,
    );
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    void this.update();
  }

  reveal(column: vscode.ViewColumn): void {
    this.panel.reveal(column, true);
  }

  scheduleUpdate(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.update(), DEBOUNCE_MS);
  }

  async update(): Promise<void> {
    if (!this.ready) {
      return;
    }
    this.pending?.cancel();
    const source = new vscode.CancellationTokenSource();
    this.pending = source;

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(this.uri);
    } catch (error) {
      this.post({ type: 'error', message: `Could not read ${this.uri.fsPath}: ${(error as Error).message}` });
      return;
    }
    if (source.token.isCancellationRequested) {
      return;
    }

    const diagrams = splitDiagrams(document.getText());
    if (diagrams.length === 0) {
      this.post({ type: 'empty', message: 'No PlantUML diagram in this file yet — add an @startuml block.' });
      return;
    }

    this.post({ type: 'rendering' });
    const cwd = path.dirname(this.uri.fsPath);
    const svgs: string[] = [];
    let renderer = '';
    try {
      for (const diagram of diagrams) {
        const result = await this.renderer.render(diagram, cwd, source.token);
        svgs.push(stripPrologue(result.svg));
        renderer = result.renderer;
      }
    } catch (error) {
      if (error instanceof vscode.CancellationError || source.token.isCancellationRequested) {
        return;
      }
      this.post({
        type: 'error',
        message: error instanceof RenderError ? error.message : String((error as Error).message ?? error),
      });
      return;
    }
    if (source.token.isCancellationRequested) {
      return;
    }
    this.post({
      type: 'diagrams',
      svgs,
      status: `${svgs.length} diagram${svgs.length === 1 ? '' : 's'} · rendered ${
        renderer === 'local' ? 'locally' : 'on the PlantUML server'
      }`,
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.pending?.cancel();
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
    this.panel.dispose();
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }
}

/** `.puml` and the other extensions PlantUML files use. */
export function isPlantUml(document: vscode.TextDocument): boolean {
  return document.languageId === 'plantuml' || /\.(puml|plantuml|pu|iuml|wsd)$/i.test(document.uri.path);
}

/** Drops the XML prologue and doctype so the SVG can be inlined into the webview. */
function stripPrologue(svg: string): string {
  const start = svg.indexOf('<svg');
  return start > 0 ? svg.slice(start) : svg;
}

/** Content options of a preview webview. Set once, at creation, so no reload races the layout. */
function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] };
}

function previewTitle(uri: vscode.Uri): string {
  return `Preview ${path.basename(uri.fsPath)}`;
}

function nonce(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 32 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function html(webview: vscode.Webview, uri: vscode.Uri): string {
  const id = nonce();
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${id}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource} data:;">
  <title>${escapeHtml(path.basename(uri.fsPath))}</title>
  <style>
    html, body { height: 100%; }
    body {
      margin: 0; padding: 0; display: flex; flex-direction: column;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      /* Opaque: a transparent webview lets the editor underneath show through. */
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, var(--vscode-foreground));
    }
    #toolbar {
      display: flex; align-items: center; gap: 4px; padding: 4px 8px;
      border-bottom: 1px solid var(--vscode-panel-border, transparent);
      background: var(--vscode-editor-background); flex: 0 0 auto;
    }
    #toolbar button {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: none; border-radius: 3px; padding: 2px 8px; cursor: pointer;
      font-family: inherit; font-size: 12px;
    }
    #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground)); }
    #zoomLabel { min-width: 46px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
    #status { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 12px; }
    #status.busy { opacity: 0.6; }
    #canvas { flex: 1 1 auto; overflow: auto; padding: 12px; }
    #canvas.dragging { cursor: grabbing; user-select: none; }
    #zoom { transform-origin: 0 0; width: max-content; }
    .diagram {
      background: #ffffff; border-radius: 4px; padding: 8px; margin-bottom: 12px;
      width: max-content; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    }
    .diagram svg { display: block; }
    #message { padding: 12px; color: var(--vscode-descriptionForeground); white-space: pre-wrap; }
    #error {
      margin: 12px; padding: 8px 12px; white-space: pre-wrap; font-family: var(--vscode-editor-font-family);
      font-size: 12px; color: var(--vscode-errorForeground);
      border-left: 3px solid var(--vscode-errorForeground);
      background: var(--vscode-inputValidation-errorBackground, transparent);
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="out" title="Zoom out">−</button>
    <span id="zoomLabel">100%</span>
    <button id="in" title="Zoom in">+</button>
    <button id="reset" title="Reset zoom to 100%">Reset</button>
    <button id="fit" title="Fit the diagram to the width of the preview">Fit</button>
    <span id="status"></span>
  </div>
  <div id="canvas">
    <div id="message" class="hidden"></div>
    <div id="error" class="hidden"></div>
    <div id="zoom"></div>
  </div>
  <script nonce="${id}">
    const vscode = acquireVsCodeApi();
    // Remembered so VS Code can restore the preview after a window reload.
    vscode.setState({ uri: ${JSON.stringify(uri.toString())} });
    const canvas = document.getElementById('canvas');
    const zoomEl = document.getElementById('zoom');
    const zoomLabel = document.getElementById('zoomLabel');
    const statusEl = document.getElementById('status');
    const messageEl = document.getElementById('message');
    const errorEl = document.getElementById('error');
    let scale = 1;

    function applyScale(next) {
      scale = Math.min(8, Math.max(0.1, next));
      zoomEl.style.transform = 'scale(' + scale + ')';
      zoomLabel.textContent = Math.round(scale * 100) + '%';
    }

    function fit() {
      const svg = zoomEl.querySelector('svg');
      if (!svg) return;
      const width = svg.getBoundingClientRect().width / scale;
      if (width > 0) applyScale((canvas.clientWidth - 44) / width);
    }

    document.getElementById('in').addEventListener('click', () => applyScale(scale * 1.2));
    document.getElementById('out').addEventListener('click', () => applyScale(scale / 1.2));
    document.getElementById('reset').addEventListener('click', () => applyScale(1));
    document.getElementById('fit').addEventListener('click', fit);

    canvas.addEventListener('wheel', (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      applyScale(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });

    let drag;
    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
      canvas.classList.add('dragging');
    });
    window.addEventListener('mousemove', (event) => {
      if (!drag) return;
      canvas.scrollLeft = drag.left - (event.clientX - drag.x);
      canvas.scrollTop = drag.top - (event.clientY - drag.y);
    });
    window.addEventListener('mouseup', () => {
      drag = undefined;
      canvas.classList.remove('dragging');
    });

    function show(element, text) {
      element.textContent = text;
      element.classList.toggle('hidden', !text);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'rendering') {
        statusEl.classList.add('busy');
        return;
      }
      statusEl.classList.remove('busy');
      if (msg.type === 'diagrams') {
        show(messageEl, '');
        show(errorEl, '');
        statusEl.textContent = msg.status;
        zoomEl.innerHTML = msg.svgs.map((svg) => '<div class="diagram">' + svg + '</div>').join('');
      } else if (msg.type === 'error') {
        statusEl.textContent = '';
        show(messageEl, '');
        show(errorEl, msg.message);
        zoomEl.innerHTML = '';
      } else if (msg.type === 'empty') {
        statusEl.textContent = '';
        show(errorEl, '');
        show(messageEl, msg.message);
        zoomEl.innerHTML = '';
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
