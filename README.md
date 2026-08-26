# AI Unified Process Navigator for VS Code

VS Code extension to navigate between `@UseCase`-annotated Java test methods and their Markdown specs in
[AI Unified Process](https://unifiedprocess.ai) projects — with a live activity diagram of the
Use Case spec you are editing.

This is the VS Code port of the [AI Unified Process IntelliJ plugin](https://github.com/AI-Unified-Process/intellij-plugin)
and follows the same conventions.

## Setup

The extension expects the workspace to define a Java annotation type named `UseCase`. It is looked up by short name,
so any package works. The canonical shape is:

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface UseCase {
    String id();

    String scenario() default "Main Success Scenario";

    String[] businessRules() default {};
}
```

When the extension opens a workspace that contains Markdown Use Case specs but no `UseCase` annotation type, it shows
a one-time notification with a **Create UseCase.java** action: pick a source root and a package and the file is
scaffolded for you (also available any time via the **AI Unified Process: Create UseCase.java Annotation** command).

## Features

### Activity diagram view

The **Diagram** view (AI Unified Process icon in the activity bar — drag it into the secondary side bar for the
IntelliJ-style layout) shows a live activity diagram of the Use Case spec in the active editor: the main flow forms
the numbered spine, and every Alternative Flow branches at the step its trigger references (e.g. `(Schritt 3)` /
`(step 3)`) and rejoins the flow after its own steps. The diagram updates as you type (debounced) and is rendered
entirely locally with a bundled Mermaid build — no external rendering service, the spec content never leaves the
editor. **AI Unified Process: Copy PlantUML Source** copies the equivalent PlantUML activity diagram to the clipboard.

Both English and German spec styles are recognised: `## Main Success Scenario` / `## Hauptszenario` /
`## Hauptablauf` for the main flow, and `## Alternative Flows` / `## Alternativszenarien` / `## Alternativabläufe`
for the alternative flows. Flow headings may carry a label (`### A1: …`, branching at the step the `**Trigger:**`
references) or a step code in the German style (`### 3a. Keine Treffer gefunden`, branching directly at step 3).
Sub-bullets under a numbered step are treated as detail and kept out of the step's diagram node.

### PlantUML preview

Open any `.puml` file (also `.plantuml`, `.pu`, `.iuml`, `.wsd`) and use the preview icon in the editor title bar or
**AI Unified Process: Open PlantUML Preview to the Side** — the Use Case diagram (`docs/use_cases.puml`) renders next
to the source and re-renders as you type. The preview zooms (buttons, `Ctrl`/`Cmd` + scroll), pans by dragging, and
shows every `@startuml` block of the file, so multi-diagram files render in full.

Rendering is local by default: the preview pipes the diagram through `plantuml` on the `PATH`, or through
`java -jar` when **`aiup.plantuml.jarPath`** points at a `plantuml.jar`. Relative `!include` paths resolve against the
file's own directory. If no local PlantUML is installed, the preview offers — once, and only after you confirm — to
render on the PlantUML server configured in **`aiup.plantuml.server`**; that sends the diagram source to that server.
**`aiup.plantuml.renderer`** (`auto` / `local` / `server`) pins the choice.

### CodeLens navigation

In Java:

* A **Spec: UC-XXX** lens above `@UseCase(id = "UC-XXX")` jumps to the matching spec file, landing on the scenario
  heading and any business rule headings referenced via `businessRules = {...}`.

In Markdown specs:

* `**Use Case ID:** UC-XXX` jumps to all test methods annotated with that ID.
* `# Title` (H1) jumps to the test class(es) containing those methods.
* `## Main Success Scenario` / `## Hauptszenario` / `## Hauptablauf` jumps to test methods with no `scenario`
  attribute (or one of those labels as the `scenario` value).
* `### A1: ...` or `### 3a. ...` (alternative-flow headings coded as `<Letter><Digits>` or `<Step><letter>`) jumps to
  test methods whose `scenario` starts with that code.
* `### BR-XXX` business rule headings — or `- **GR-XXX:** …` bullet items in the German style — jump to test methods
  that reference that rule via `businessRules = {"BR-XXX"}`, scoped to the Use Case declared by the spec file
  (rule ids are unique only within a UC).

### Go to Definition and Find References

Both work in both directions, mirroring the CodeLenses:

* On a `@UseCase` annotation or its `id` literal — the spec leaves (scenario heading + BR headings).
* On a string inside `businessRules = {...}` — the matching `### BR-XXX` heading in the spec.
* On `**Use Case ID:** UC-XXX`, the H1 title, `## Main Success Scenario`, `### A1: ...`, and `### BR-XXX` lines —
  the corresponding test methods or test classes.

### Diagnostics

* **Use Case ID has no matching spec** — flags `@UseCase(id = "UC-XXX")` whose ID has no spec file in the workspace.

## Conventions used

The extension works with the Markdown conventions from the AI Unified Process PetClinic example:

```markdown
# View Veterinarians

**Use Case ID:** UC-002

## Main Success Scenario

### A1: No Veterinarians Found

### BR-001: Lazy Loading
```

and with the German AI Unified Process spec style, which declares the ID in the title and codes alternative flows by step:

```markdown
# UC-001: Kunde suchen

## Hauptablauf

## Alternativabläufe

### 3a. Keine Treffer gefunden

## Geschäftsregeln

- **GR-001:** Inaktive Kunden werden standardmässig nicht angezeigt.
```

Use Case IDs may be plain `UC-XXX` or the `SUC-XXX` / `BUC-XXX` variants (System / Business Use Case). Spec files are
matched three ways:

* **By file name** — the ID at the start of the name (`UC-002-view-veterinarians.md`,
  `UC-032_Kundeninformationen_bearbeiten.md`, `SUC-001-*.md`, `BUC-001-*.md`) or after an arbitrary project prefix
  (`petclinic-UC-002-*.md`, `*-SUC-*.md`, `*-BUC-*.md`).
* **By body line** — a `**Use Case ID:** UC-XXX` declaration anywhere in the file.
* **By title** — an H1 starting with the ID, e.g. `# UC-001: Kunde suchen` (used when no body line exists).

## Build

```bash
npm install
npm run build        # type-check + bundle to dist/extension.js
npm test             # unit tests (vitest)
```

## Try it locally

Open this folder in VS Code and press `F5` (Run Extension). A new Extension Development Host window opens with the
extension loaded — open your `aiup-petclinic` project in it.

## Install

```bash
npm run package      # produces aiup-navigator-<version>.vsix
```

Then in VS Code: `Extensions` panel → `…` menu → `Install from VSIX...`.

## Notes

* The spec lookup scans Markdown files in the workspace and keeps them in an in-memory index refreshed by file
  watchers. For typical AI Unified Process repos this is fast because the spec folder is small.
* Java files are scanned with a lightweight regex-based reader (no Java language server required). If you rename the
  annotation, the lookup still works as long as it is called `UseCase`.
