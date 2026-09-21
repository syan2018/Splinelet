import type { DocumentV4, JsonObject, PortRef } from '../document/types.ts';

export type Domain = 'curves' | 'regions';
export type StageStatus = 'ready' | 'empty' | 'absent' | 'blocked';
export type Diagnostic = {
  code: string;
  message: string;
  componentId?: string;
};
export type StageResult<T = unknown> = {
  domain: Domain;
  status: StageStatus;
  value?: T;
  diagnostics: Diagnostic[];
  dependencies: string[];
};
export type PortSpec = { domain: Domain; min?: number; max?: number };
export type OperatorSpec = {
  type: string;
  inputPorts: Record<string, PortSpec>;
  outputPorts: Record<string, { domain: Domain }>;
  validateParams?: (params: JsonObject) => void | string | boolean;
  dependencies?: (args: {
    document: DocumentV4;
    operator: { id: string; params: JsonObject };
    ownerNodeId: string;
  }) => string[];
  evaluate?: (args: {
    document: DocumentV4;
    operator: unknown;
    ownerNodeId: string;
    inputs: Record<string, StageResult[]>;
    context: unknown;
  }) => Record<string, StageResult>;
  bypass?: Record<string, string>;
  rebase?: (
    operator: unknown,
    args: {
      transform: [number, number, number, number, number, number];
      document: DocumentV4;
      ownerNodeId: string;
    },
  ) => unknown;
  copy?: (
    operator: unknown,
    args: { idMap: ReadonlyMap<string, string> },
  ) => unknown;
};
export type EvaluationSnapshot = Readonly<{
  epoch: string;
  revision: number;
  previewId: string | null;
  components: Readonly<
    Record<string, Readonly<{ ports: Readonly<Record<string, StageResult>> }>>
  >;
  published: Readonly<Record<string, StageResult>>;
  diagnostics: readonly Diagnostic[];
}>;
export type PublishedPort = PortRef;
