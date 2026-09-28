import Modeler from 'bpmn-js/lib/Modeler';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { BpmnPropertiesPanelModule, BpmnPropertiesProviderModule } from 'bpmn-js-properties-panel';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css';
import './bpmnEditor.css';
import { activityUseCaseId } from '../src/core/patterns';

/*
 * The BPMN editor webview, the same bpmn-js modeler the AI Unified Process Studio and
 * the IntelliJ plugin use: palette and canvas next to the properties panel of the
 * selected element; for a read-only file the navigable viewer without palette and
 * panel. The text document holds the BPMN 2.0 XML: a value set by the extension is
 * imported unchanged, and only an edit of the user serializes the model again and
 * reports it — importing fires no command, so opening a file never marks it dirty.
 * Undo and redo belong to the text document (VS Code's undo stack), not to bpmn-js.
 * An activity named after a use case ("UC-004 Find Owners") opens its spec: from the
 * context pad in the modeler, by a click in the viewer.
 *
 * Messages in: init {xml, readOnly}, setXml {xml}, export {id, format}.
 * Messages out: ready, changed {xml}, openUseCase {id}, exported {id, data},
 * exportFailed {id, message}.
 */

type Viewer = Modeler | NavigatedViewer;

type Inbound =
  | { type: 'init'; xml: string; readOnly: boolean }
  | { type: 'setXml'; xml: string }
  | { type: 'export'; id: number; format: 'svg' | 'png' };

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();

let viewer: Viewer | null = null;
let currentXml = '';
let importSequence = 0;
let imported = false;
// while the XML cannot be displayed, an edit of the stale diagram must not overwrite it
let broken = false;
let debounce: number | undefined;

const canvas = document.getElementById('canvas')!;
const panel = document.getElementById('properties')!;
const errorBar = document.getElementById('error')!;

function init(xml: string, readOnly: boolean): void {
  currentXml = xml ?? '';
  if (viewer) {
    void importXml();
    return;
  }
  if (readOnly) {
    panel.remove();
    viewer = new NavigatedViewer({ container: canvas });
    viewer.on('element.click', (event: { element: any }) => {
      const id = useCaseId(event.element);
      if (id) vscode.postMessage({ type: 'openUseCase', id });
    });
  } else {
    const modeler = new Modeler({
      container: canvas,
      propertiesPanel: { parent: panel },
      additionalModules: [BpmnPropertiesPanelModule, BpmnPropertiesProviderModule, UseCaseContextPadModule],
    } as any);
    modeler.on('commandStack.changed', (event: { trigger?: string }) => {
      // clearing the stack on an import is no edit of the user
      if (event.trigger !== 'clear' && !broken) {
        scheduleChange();
      }
    });
    // VS Code forwards undo/redo to the text document; bpmn-js must not undo as well
    const keyboard = modeler.get('keyboard') as any;
    keyboard.addListener(10000, ({ keyEvent }: { keyEvent: KeyboardEvent }) =>
      (keyEvent.ctrlKey || keyEvent.metaKey) && ['z', 'Z', 'y', 'Y'].includes(keyEvent.key) ? true : undefined,
    );
    viewer = modeler;
  }
  void importXml();
}

/** The use case an activity references by the leading ID of its name, if any. */
function useCaseId(element: any): string | undefined {
  const business = element?.businessObject;
  if (!business || element.labelTarget || !business.$instanceOf?.('bpmn:Activity')) return undefined;
  return activityUseCaseId(business.name ?? '');
}

const OPEN_USE_CASE_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.2">' +
      '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5M5.5 13h3"/></svg>',
  );

/** Adds "Open use case" to the context pad of an activity that references one. */
class UseCaseContextPad {
  static $inject = ['contextPad'];

  constructor(contextPad: any) {
    contextPad.registerProvider(this);
  }

  getContextPadEntries(element: any): Record<string, unknown> {
    const id = useCaseId(element);
    if (!id) return {};
    return {
      'aiup.open-use-case': {
        group: 'aiup',
        imageUrl: OPEN_USE_CASE_ICON,
        title: `Open use case ${id}`,
        action: { click: () => vscode.postMessage({ type: 'openUseCase', id }) },
      },
    };
  }
}

const UseCaseContextPadModule = {
  __init__: ['aiupUseCaseContextPad'],
  aiupUseCaseContextPad: ['type', UseCaseContextPad],
};

/** Shows the activities that open a use case with a pointer in the viewer. */
function markUseCases(): void {
  if (!viewer || viewer instanceof Modeler) return;
  const drawing = viewer.get('canvas') as any;
  for (const element of (viewer.get('elementRegistry') as any).getAll()) {
    if (useCaseId(element)) drawing.addMarker(element, 'aiup-use-case');
  }
}

function setXml(xml: string): void {
  const value = xml ?? '';
  if (value === currentXml) return;
  currentXml = value;
  void importXml();
}

async function importXml(): Promise<void> {
  const current = viewer;
  if (!current) return;
  const sequence = ++importSequence;
  window.clearTimeout(debounce);
  const drawing = current.get('canvas') as any;
  // keep the zoom and scroll position when the text is edited next to the diagram
  const viewbox = imported ? drawing.viewbox() : null;
  try {
    let warnings = 0;
    if (currentXml.trim()) {
      const result = await current.importXML(currentXml);
      warnings = result.warnings.length;
    } else if (current instanceof Modeler) {
      // an empty file starts as a new diagram; it is written on the first edit
      await current.createDiagram();
    }
    if (sequence !== importSequence) return;
    if (viewbox) {
      drawing.viewbox(viewbox);
    } else {
      drawing.zoom('fit-viewport', 'auto');
    }
    markUseCases();
    imported = true;
    broken = false;
    showError(
      warnings > 0
        ? `${warnings} element(s) of this file are unknown to the editor and may not survive an edit in the diagram.`
        : null,
      'warning',
    );
  } catch (error: unknown) {
    if (sequence !== importSequence) return;
    broken = true;
    showError(`The BPMN file cannot be displayed: ${messageOf(error)} — fix the XML in the text editor.`, 'error');
  }
}

function scheduleChange(): void {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(async () => {
    if (!viewer) return;
    const { xml } = await viewer.saveXML({ format: true });
    if (xml !== undefined && xml !== currentXml) {
      currentXml = xml;
      vscode.postMessage({ type: 'changed', xml });
    }
  }, 150);
}

function showError(message: string | null, kind: 'error' | 'warning'): void {
  errorBar.textContent = message ?? '';
  errorBar.className = kind;
  errorBar.hidden = message === null;
}

/** Exports the shown diagram as SVG text, or as PNG (base64) at twice the size on white. */
async function exportDiagram(id: number, format: 'svg' | 'png'): Promise<void> {
  try {
    const svg = await saveSvg();
    vscode.postMessage({ type: 'exported', id, data: format === 'svg' ? svg : await toPng(svg) });
  } catch (error: unknown) {
    vscode.postMessage({ type: 'exportFailed', id, message: messageOf(error) });
  }
}

async function saveSvg(): Promise<string> {
  if (!viewer) throw new Error('The diagram is not loaded yet.');
  const { svg } = await viewer.saveSVG();
  return svg;
}

async function toPng(svg: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = 2;
    const drawing = document.createElement('canvas');
    drawing.width = image.naturalWidth * scale;
    drawing.height = image.naturalHeight * scale;
    const context = drawing.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, drawing.width, drawing.height);
    context.drawImage(image, 0, 0, drawing.width, drawing.height);
    return drawing.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

window.addEventListener('message', (event: MessageEvent<Inbound>) => {
  const message = event.data;
  switch (message?.type) {
    case 'init':
      init(message.xml, message.readOnly);
      break;
    case 'setXml':
      setXml(message.xml);
      break;
    case 'export':
      void exportDiagram(message.id, message.format);
      break;
  }
});

vscode.postMessage({ type: 'ready' });
