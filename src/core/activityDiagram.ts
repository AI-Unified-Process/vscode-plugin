/**
 * Generates the activity diagram of a Use Case spec from its Main Success
 * Scenario and Alternative Flows: the main scenario is the numbered spine, every
 * alternative flow branches at the step its trigger references and rejoins the flow
 * after its own steps.
 *
 * This is a TypeScript port of the IntelliJ plugin's `ActivityDiagram` generator,
 * fed by a lenient Markdown reader — the preview should render whatever it can
 * read, not reject the file. The diagram is a view only; the Markdown spec stays
 * the single source of truth. Two output formats: PlantUML source (for export)
 * and Mermaid source (rendered locally in the webview — no Java, no external
 * rendering service, the spec content never leaves the editor).
 */

export interface AlternativeFlow {
  title: string;
  trigger: string;
  steps: string[];
  /** The flow's own code from its heading (`A1`, `3a`), if it has one. */
  code?: string;
  /** The branch step encoded in a step-coded heading like `3a.`, if any. */
  branchStep?: number;
}

export interface Scenario {
  mainSteps: string[];
  flows: AlternativeFlow[];
}

const MAIN_HEADING = /^#{2,6}\s+(?:Main\s+Success\s+Scenario|Hauptszenario|Hauptablauf)\s*$/i;

const FLOWS_HEADING =
  /^#{2,6}\s+(?:Alternative\s+Flows|Alternativszenarien|Alternative\s+Abläufe|Alternativabläufe)\s*$/i;

/** A flow heading, e.g. `### A1: Neues Diagramm`; the label part is optional. */
const FLOW_HEADING = /^#{3,6}\s+(.*)$/;

const FLOW_LABEL = /^(A\d+)\s*:\s*(.*)$/;

/**
 * A step-coded flow heading in the German spec style, e.g.
 * `3a. Keine Treffer gefunden`: the digits name the main-scenario step the
 * flow branches at, digits+letter are the flow's code.
 */
const STEP_CODED_FLOW_LABEL = /^(\d+)([a-z])\s*[.:)]?\s*(.*)$/;

const NUMBERED_ITEM = /^(\d+)\.\s+(.*)$/;

/**
 * A step reference in a trigger, e.g. `(Schritt 5)` or `(step 5)`; a reference into
 * another use case like `UC-012 Schritt 8` names that use case right before the word
 * and is not a branch point of this diagram.
 */
const STEP_REFERENCE = /([SB]?UC-\d+\s+)?(?:Schritt|Step|schritt|step)\s+(\d+)/g;

const TRIGGER_FIELD = '**Trigger:**';

const FLOW_FIELD = '**Flow:**';

/** The width the step and trigger texts are wrapped at, so the diagram stays legible. */
const WRAP_WIDTH = 48;

/**
 * Reads the Main Success Scenario steps and the Alternative Flows from the spec
 * Markdown. Lenient by design: unknown lines are skipped, wrapped lines are joined
 * into the item they belong to.
 */
export function parse(markdown: string): Scenario {
  const lines = markdown.split('\n').map((line) => line.replace(/\s+$/, ''));
  const mainSteps: string[] = [];
  const flows: AlternativeFlow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (MAIN_HEADING.test(line)) {
      index = parseNumberedItems(lines, index + 1, mainSteps);
    } else if (FLOWS_HEADING.test(line)) {
      index = parseFlows(lines, index + 1, flows);
    } else {
      index++;
    }
  }
  return { mainSteps, flows };
}

/** The PlantUML source; empty while the main scenario has no steps yet. */
export function generatePlantUml(scenario: Scenario): string {
  if (scenario.mainSteps.length === 0) {
    return '';
  }
  const byStep = flowsByStep(scenario);
  let source = '@startuml\nstart\n';
  scenario.mainSteps.forEach((step, stepIndex) => {
    source += `:${plantUmlLabel(`${stepIndex + 1}. ${step}`)};\n`;
    for (const flow of byStep[stepIndex]) {
      source += plantUmlBranch(scenario, flow);
    }
  });
  source += 'stop\n@enduml\n';
  return source;
}

/**
 * The Mermaid flowchart equivalent of [generatePlantUml], rendered locally in
 * the diagram webview. Same structure: the main steps form the spine, each
 * alternative flow is a decision that branches into its own steps and rejoins
 * the spine before the next step.
 */
export function generateMermaid(scenario: Scenario): string {
  if (scenario.mainSteps.length === 0) {
    return '';
  }
  const byStep = flowsByStep(scenario);
  const out: string[] = ['flowchart TD'];
  // Edges into the next node are deferred until that node exists, so branch
  // ends and the pass-through side of a decision rejoin the spine naturally.
  let pending: { from: string; label?: string }[] = [{ from: 'n_start' }];
  out.push('n_start([Start])');
  const connect = (to: string) => {
    for (const edge of pending) {
      out.push(edge.label ? `${edge.from} -->|${edge.label}| ${to}` : `${edge.from} --> ${to}`);
    }
    pending = [{ from: to }];
  };
  let flowSeq = 0;
  scenario.mainSteps.forEach((step, stepIndex) => {
    const stepId = `s${stepIndex + 1}`;
    out.push(`${stepId}["${mermaidLabel(`${stepIndex + 1}. ${step}`)}"]`);
    connect(stepId);
    for (const flow of byStep[stepIndex]) {
      flowSeq++;
      const code = flow.code ?? `A${scenario.flows.indexOf(flow) + 1}`;
      const condition = flow.trigger.trim() !== '' ? flow.trigger : flow.title;
      const decisionId = `d${flowSeq}`;
      out.push(`${decisionId}{"${mermaidLabel(`${code}: ${condition}`)}"}`);
      connect(decisionId);
      if (flow.steps.length > 0) {
        let previous = decisionId;
        flow.steps.forEach((flowStep, i) => {
          const flowStepId = `f${flowSeq}_${i + 1}`;
          out.push(`${flowStepId}["${mermaidLabel(`${code}.${i + 1} ${flowStep}`)}"]`);
          out.push(
            previous === decisionId
              ? `${previous} -->|${code}| ${flowStepId}`
              : `${previous} --> ${flowStepId}`,
          );
          previous = flowStepId;
        });
        pending = [{ from: decisionId }, { from: previous }];
      }
    }
  });
  out.push('n_end([End])');
  connect('n_end');
  return out.join('\n');
}

function parseNumberedItems(lines: string[], start: number, items: string[]): number {
  let index = start;
  while (index < lines.length && !lines[index].startsWith('#')) {
    const line = lines[index];
    const match = NUMBERED_ITEM.exec(line.trim());
    if (match !== null && !line.startsWith(' ')) {
      const joined = joinContinuation(lines, index + 1, match[2].trim());
      items.push(joined.text);
      index = joined.index;
    } else {
      index++;
    }
  }
  return index;
}

function parseFlows(lines: string[], start: number, flows: AlternativeFlow[]): number {
  let index = start;
  while (index < lines.length && !lines[index].startsWith('## ')) {
    const heading = FLOW_HEADING.exec(lines[index]);
    if (heading === null) {
      index++;
      continue;
    }
    const headingText = heading[1].trim();
    let code: string | undefined;
    let branchStep: number | undefined;
    let title = headingText;
    const label = FLOW_LABEL.exec(headingText);
    const stepCoded = STEP_CODED_FLOW_LABEL.exec(headingText);
    if (label !== null) {
      code = label[1];
      title = label[2].trim();
    } else if (stepCoded !== null) {
      branchStep = parseInt(stepCoded[1], 10);
      code = stepCoded[1] + stepCoded[2];
      title = stepCoded[3].trim() || headingText;
    }
    index++;
    while (index < lines.length && lines[index].trim() === '') {
      index++;
    }
    let trigger = '';
    if (index < lines.length && lines[index].startsWith(TRIGGER_FIELD)) {
      const joined = joinContinuation(
        lines,
        index + 1,
        lines[index].slice(TRIGGER_FIELD.length).trim(),
      );
      trigger = joined.text;
      index = joined.index;
    }
    if (index < lines.length && lines[index].trim() === FLOW_FIELD) {
      index++;
    }
    const steps: string[] = [];
    index = parseNumberedItems(lines, index, steps);
    if (trigger !== '' || steps.length > 0) {
      flows.push({ title, trigger, steps, code, branchStep });
    }
  }
  return index;
}

/**
 * Wrapped lines are joined into the current item: everything up to the next blank
 * line, structure marker, sub-bullet or heading belongs to the item, indented or
 * not, so hand-formatted files stay readable. Sub-bullets (`- …` / `* …` under a
 * numbered step) are detail, not part of the step label, and are skipped.
 */
function joinContinuation(
  lines: string[],
  start: number,
  initial: string,
): { index: number; text: string } {
  let index = start;
  let text = initial;
  while (index < lines.length && isContinuation(lines[index])) {
    text += ' ' + lines[index].trim();
    index++;
  }
  return { index, text };
}

function isContinuation(line: string): boolean {
  const trimmed = line.trimStart();
  if (
    line.trim() === '' ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('**') ||
    trimmed.startsWith('- ') ||
    trimmed.startsWith('* ')
  ) {
    return false;
  }
  return !NUMBERED_ITEM.test(line.trim()) || line.startsWith(' ');
}

/**
 * Every alternative flow branches at the step its heading code (`3a` -> step 3)
 * or its trigger references; a flow that names no step of the scenario branches
 * after the last step.
 */
function flowsByStep(scenario: Scenario): AlternativeFlow[][] {
  const byStep: AlternativeFlow[][] = scenario.mainSteps.map(() => []);
  for (const flow of scenario.flows) {
    const coded =
      flow.branchStep !== undefined &&
      flow.branchStep >= 1 &&
      flow.branchStep <= scenario.mainSteps.length
        ? flow.branchStep
        : undefined;
    const step = coded ?? referencedStep(flow.trigger, scenario.mainSteps.length);
    byStep[step === undefined ? scenario.mainSteps.length - 1 : step - 1].push(flow);
  }
  return byStep;
}

function referencedStep(trigger: string, stepCount: number): number | undefined {
  for (const match of trigger.matchAll(STEP_REFERENCE)) {
    if (match[1] !== undefined && match[1] !== '') {
      // a step of another use case, not a branch point of this diagram
      continue;
    }
    const step = parseInt(match[2], 10);
    if (step >= 1 && step <= stepCount) {
      return step;
    }
  }
  return undefined;
}

function plantUmlBranch(scenario: Scenario, flow: AlternativeFlow): string {
  const flowLabel = flow.code ?? `A${scenario.flows.indexOf(flow) + 1}`;
  const condition = flow.trigger.trim() !== '' ? flow.trigger : flow.title;
  let source = `if (${plantUmlLabel(`${flowLabel}: ${condition}`)}) then (${flowLabel})\n`;
  flow.steps.forEach((step, stepIndex) => {
    source += `  :${plantUmlLabel(`${flowLabel}.${stepIndex + 1} ${step}`)};\n`;
  });
  source += 'endif\n';
  return source;
}

/**
 * An activity label: parentheses and semicolons would end the PlantUML condition or
 * label early, so they are replaced; long texts wrap at word boundaries so the
 * diagram stays legible.
 */
function plantUmlLabel(text: string): string {
  const sanitized = text
    .replace(/\(/g, '[')
    .replace(/\)/g, ']')
    .replace(/;/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  return wrap(sanitized, '\\n');
}

/** A Mermaid node label: quotes would end the quoted label early. */
function mermaidLabel(text: string): string {
  const sanitized = text.replace(/"/g, '#quot;').replace(/\s+/g, ' ').trim();
  return wrap(sanitized, '<br/>');
}

function wrap(text: string, lineBreak: string): string {
  let wrapped = '';
  let lineLength = 0;
  for (const word of text.split(' ')) {
    if (lineLength > 0 && lineLength + 1 + word.length > WRAP_WIDTH) {
      wrapped += lineBreak;
      lineLength = 0;
    } else if (lineLength > 0) {
      wrapped += ' ';
      lineLength++;
    }
    wrapped += word;
    lineLength += word.length;
  }
  return wrapped;
}
