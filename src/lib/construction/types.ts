import type {
  DocumentV4,
  DocumentV5,
  JsonObject,
  PortRef,
  InputRef,
} from '../document/types.ts';

export type ConstructionDocument = DocumentV4 | DocumentV5;

export type Domain = 'curves' | 'regions';
export type StageStatus = 'ready' | 'empty' | 'absent' | 'blocked';
export type Diagnostic = {
  code: string;
  message: string;
  componentId?: string;
  severity?: 'error' | 'warning' | 'info';
  inputs?: {
    port: string;
    index: number;
    reference: InputRef;
    diagnostics: Diagnostic[];
  }[];
};
export type EvaluatedComponent = Readonly<{
  ports: Readonly<Record<string, StageResult>>;
  inputs?: {
    port: string;
    index: number;
    reference: InputRef;
    status: StageStatus;
    diagnostics: Diagnostic[];
  }[];
}>;
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
    document: ConstructionDocument;
    operator: { id: string; params: JsonObject };
    ownerNodeId: string;
  }) => string[];
  evaluate?: (args: {
    document: ConstructionDocument;
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
      document: ConstructionDocument;
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
  components: Readonly<Record<string, EvaluatedComponent>>;
  published: Readonly<Record<string, StageResult>>;
  diagnostics: readonly Diagnostic[];
}>;
export type PublishedPort = PortRef;
