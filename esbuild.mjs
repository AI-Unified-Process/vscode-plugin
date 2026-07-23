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

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(options);
  console.log('built dist/extension.js');
}
