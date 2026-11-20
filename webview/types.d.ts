/*
 * bpmn-js-properties-panel 5 ships no type declarations; the editor only passes its
 * modules on to the modeler, so an opaque module type is enough. The stylesheets are
 * side-effect imports esbuild bundles.
 */
declare module 'bpmn-js-properties-panel' {
  export const BpmnPropertiesPanelModule: unknown;
  export const BpmnPropertiesProviderModule: unknown;
}

/* bpmn-js-create-append-anything ships no type declarations either. */
declare module 'bpmn-js-create-append-anything' {
  export const CreateAppendAnythingModule: unknown;
}

declare module '*.css';
