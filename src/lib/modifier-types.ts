// UI contract for the declarative program and its evaluated diagnostics.
import type { Cubic, Point } from './project';
export type JoinEndpoint = {
  edgeEnd: { kind: string; sketchId: string; edgeId: string; end: string };
  instances?: { operatorId: string; index: number }[];
  selector?: { operatorId: string; index: number | string; wrap?: boolean };
};
export type JoinConnection = { a: JoinEndpoint; b: JoinEndpoint };
export type JoinEndpointOption = {
  label: string;
  endpoint: JoinEndpoint;
  cubic: number[][];
};
export type CurvePreview = {
  defaultPreview?: boolean;
  objectId: string;
  stageId: string;
  name: string;
  curves: Cubic[];
  junctions: { point: Point; degree: number }[];
  diagnostic?: string;
};
export type SurfaceRef = { key: string; name: string; topology?: string };
export type SurfaceScope = { kind: 'all' | 'selected'; refs?: SurfaceRef[] };
export type SurfaceOption = { ref: SurfaceRef; name: string };
export type ModifierControls = {
  endpoints?: JoinEndpointOption[];
  operatorId: string;
  ownerNodeId: string;
  type: string;
  values: {
    name: string;
    enabled: boolean;
    angleDeg?: number;
    centerMM?: { x: number; y: number };
    count?: number;
    distanceMM?: number;
    widthMM?: number;
    operation?: string;
    connections?: JoinConnection[];
    rule?: string;
    anchors?: [number, number][];
    toleranceMM?: number;
  };
  editableFields: readonly string[];
  drivenFields: readonly string[];
  diagnostics: readonly { field: string; message: string }[];
  locked: boolean;
};
export type ModifierCapability = {
  enabled: boolean;
  reason: string | null;
};
export type ModifierStructureCapabilities = {
  moveUp: ModifierCapability;
  moveDown: ModifierCapability;
  remove: ModifierCapability;
};
export type ModifierInputRef = {
  kind: 'path' | 'region' | 'object';
  id: string;
  projection?: 'surface' | 'outline';
};
export type SurfaceModifier = {
  id: string;
  name: string;
  type:
    | 'boolean'
    | 'split'
    | 'offset'
    | 'radial_array'
    | 'curve_mirror'
    | 'curve_array'
    | 'fill';
  operation?: string;
  enabled: boolean;
  targets: SurfaceScope;
  input?: ModifierInputRef;
  distanceMM?: number;
  joinMM?: number;
  count?: number;
  angleDeg?: number;
  centerMM?: { x: number; y: number };
};
export type ModifierObject = {
  id: string;
  name: string;
  modifierAdd?: {
    types: string[];
    reason: string | null;
    endpoints?: JoinEndpointOption[];
  };
  modifiers?: SurfaceModifier[];
  sources?: Record<string, { regionId: string; modifiers: SurfaceModifier[] }>;
};
export type ModifierProject = {
  paths: readonly { id: string; name: string; closed: boolean }[];
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
  modifierModel?: 'program';
  curvePreviews?: CurvePreview[];
  errors?: { objectId: string; message: string; pathIds?: string[] }[];
  creation: { objects: ModifierObject[] };
  cells: ModifierCell[];
  modifierBaseCells?: ModifierCell[];
  modifierStatus?: {
    objectId: string;
    modifierId: string;
    inputOptions: SurfaceOption[];
    controls?: ModifierControls;
    structure?: ModifierStructureCapabilities;
    error?: string;
    note?: string;
  }[];
};
export type ModifierCommand = (
  action: string,
  args: Record<string, unknown>,
) => void;
