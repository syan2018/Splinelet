// UI contract for the declarative program and its evaluated diagnostics.
export type SurfaceRef = { key: string; name: string; topology?: string };
export type SurfaceScope = { kind: 'all' | 'selected'; refs?: SurfaceRef[] };
export type SurfaceOption = { ref: SurfaceRef; name: string };
export type ModifierInputRef = {
  kind: 'path' | 'region' | 'object';
  id: string;
  projection?: 'surface' | 'outline';
};
export type SurfaceModifier = {
  id: string;
  name: string;
  type: 'boolean' | 'split' | 'offset';
  operation?: string;
  enabled: boolean;
  targets: SurfaceScope;
  input?: ModifierInputRef;
  distanceMM?: number;
  joinMM?: number;
};
export type ModifierObject = {
  id: string;
  name: string;
  modifiers?: SurfaceModifier[];
  sources?: Record<string, { regionId: string; modifiers: SurfaceModifier[] }>;
};
export type ModifierProject = {
  paths: { id: string; name: string; closed: boolean }[];
  model?: {
    regions: { id: string; name: string }[];
    features: { id: string; name: string }[];
  };
};
export type ModifierCell = {
  objectId: string;
  key: string;
  name?: string;
  featureId?: string;
  regionId?: string;
  boundaryPathIds?: string[];
  modifierResult?: { id: string };
  targetTopology?: string;
};
export type ModifierScene = {
  errors?: { objectId: string; message: string; pathIds?: string[] }[];
  creation: { objects: ModifierObject[] };
  cells: ModifierCell[];
  modifierBaseCells?: ModifierCell[];
  modifierStatus?: {
    objectId: string;
    modifierId: string;
    inputOptions: SurfaceOption[];
    error?: string;
    note?: string;
  }[];
};
export type ModifierCommand = (
  action: string,
  args: Record<string, unknown>,
) => void;
