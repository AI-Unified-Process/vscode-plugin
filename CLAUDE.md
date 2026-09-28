# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension (TypeScript) that adds CodeLens/Definition/Reference navigation between `@UseCase`-annotated Java
test methods and their Markdown specs in AI Unified Process projects, plus a live activity diagram webview.
It is the VS Code port of the sibling `../intellij-plugin` and must stay behaviour-compatible with it — the two
plugins share the AI Unified Process convention contract.

## Common commands

```bash
npm install          # once
npm run check        # tsc --noEmit
npm run build        # type-check + esbuild bundle to dist/extension.js and the BPMN webviews to media/ (also copies mermaid.min.js to media/)
npm test             # vitest unit tests (src/core/*.test.ts)
npm run watch        # esbuild watch mode (use with F5 / Run Extension)
npm run package      # build + vsce package -> aiup-navigator-<version>.vsix
```

## Architecture

Two layers, split so the convention logic stays unit-testable without a VS Code host:

- **`src/core/`** — pure TypeScript, no `vscode` imports, covered by vitest:
    - `patterns.ts`: the AI Unified Process convention contract (ID shapes, spec file names, heading regexes), ported 1:1 from the
      IntelliJ plugin's `UseCaseIndex`. Every component parses specs through these shared patterns — keep it that way.
    - `specSites.ts`: classifies a Markdown line into the five navigation sites (UC-ID line, BR site, H1 title,
      main-scenario heading, alt-flow heading) in the same precedence order as the IntelliJ line marker provider.
    - `activityDiagram.ts`: lenient spec reader + diagram generators (PlantUML for export, Mermaid for the webview).
      Ported from the IntelliJ `ActivityDiagram`; its tests are ported from `ActivityDiagramTest` — behaviour changes
      must be mirrored in the IntelliJ plugin.
    - `javaScan.ts`: regex-based `@UseCase` scanner (VS Code has no Java PSI). Handles balanced parens, string
      escapes, and skips sibling annotations to find the annotated method name.
- **`src/`** — the VS Code layer:
    - `workspaceIndex.ts`: in-memory index of all `.md`/`.java` files, kept fresh by a `FileSystemWatcher` plus
      `onDidChangeTextDocument` (dirty buffers win over disk). All queries (`testMethodsFor*`, `specFilesFor`,
      `scenarioLocation`, …) mirror the IntelliJ `UseCaseIndex` API.
    - `providers.ts`: CodeLens + Definition + Reference providers for both languages. `specSiteTargets` is the single
      resolution point for Markdown sites so all three providers stay in sync.
    - `diagnostics.ts`: the "Use Case ID has no matching spec" inspection.
    - `diagramView.ts`: the `aiup.diagram` webview view; renders Mermaid from a bundled `media/mermaid.min.js`
      (copied from node_modules by `esbuild.mjs` — never committed).
    - `scaffold.ts`: one-time "Create UseCase.java" offer + command.
    - `bpmnEditor.ts`: the `aiup.bpmnEditor` custom text editor for `*.bpmn` — the bpmn-js modeler + properties
      panel of the AI Unified Process Studio, ported from the IntelliJ `BpmnFileEditor`. The webview posts
      `changed {xml}`, which replaces the document text; document edits are pushed back as `setXml` (debounced).
      Undo/redo belong to the text document: the webview stops bpmn-js from handling the undo/redo keys. SVG/PNG
      export (`aiup.exportBpmnSvg` / `aiup.exportBpmnPng`) asks the webview (`export {id, format}`). An activity
      whose name starts with a Use Case ID (`ACTIVITY_USE_CASE_REF`, imported by the webview from `patterns.ts`)
      gets an "Open use case" context pad entry (a click in the read-only viewer); the webview posts
      `openUseCase {id}` and the extension opens the spec via `specFilesFor`.
- **`webview/`** — browser code bundled by `esbuild.mjs` into `media/` (never committed), type-checked with its own
  `webview/tsconfig.json` (DOM lib):
    - `bpmnEditor.ts` + `bpmnEditor.css` → `media/bpmn-editor.{js,css}`: the editor webview.
    - `bpmnPreview.ts` → `media/bpmn-preview.js`, contributed as `markdown.previewScripts`: hides every
      `pre > code.language-bpmn` of the Markdown preview and renders the diagram after it, re-inserted on every
      `vscode.markdown.updateContent` from a source-keyed cache. Same script as the IntelliJ plugin's
      `bpmn-editor/src/preview.ts` apart from the update hook — keep them in sync, and keep the bpmn-js versions
      in line with the studio.

## Convention contract with consumer projects

Same as the IntelliJ plugin (see `../intellij-plugin/CLAUDE.md`): annotation type `UseCase` with `id` / `scenario` /
`businessRules`; IDs `UC-XXX` or `SUC-XXX` / `BUC-XXX`; specs matched by file name, `**Use Case ID:**` body line, or
H1 title; business rules as `### BR-XXX` headings or `- **GR-XXX:** …` bullets; main flow headings in English and
German; alt flows coded `A1` or step-coded `3a`. When changing any pattern, change it in `src/core/patterns.ts` only
and mirror the change in the IntelliJ plugin's `UseCaseIndex`.
