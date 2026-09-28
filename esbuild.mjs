import * as esbuild from 'esbuild';
import { copyFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

// The webview loads Mermaid from the extension's media folder; ship the
// prebuilt UMD bundle instead of bundling it into the extension host code.
await copyFile('node_modules/mermaid/dist/mermaid.min.js', 'media/mermaid.min.js');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
};

// The BPMN editor webview and the BPMN fences of the Markdown preview run bpmn-js in
// the browser; both are bundled into media/ (the editor with its stylesheet, the BPMN
// font inlined), so nothing is loaded from the network.
const webviewOptions = {
  entryPoints: {
    'bpmn-editor': 'webview/bpmnEditor.ts',
    'bpmn-preview': 'webview/bpmnPreview.ts',
  },
  bundle: true,
  outdir: 'media',
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: !watch,
  legalComments: 'none',
  // the embedded font already carries a WOFF data URL; the fallback formats are never loaded
  external: ['../font/*'],
};

if (watch) {
  const contexts = await Promise.all([esbuild.context(options), esbuild.context(webviewOptions)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('watching…');
} else {
  await Promise.all([esbuild.build(options), esbuild.build(webviewOptions)]);
  console.log('built dist/extension.js, media/bpmn-editor.js, media/bpmn-preview.js');
}
