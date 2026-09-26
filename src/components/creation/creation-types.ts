import type { OutputRef } from '@/lib/document/types';
import type {
  ModifierObject,
  ModifierScene,
  SurfaceModifier,
} from '@/lib/modifier-types';

export type Swatch = { id: string; name: string; color: string };
export type CreationObject = ModifierObject & {
  id: string;
  name: string;
  pathIds: string[];
  roles: Record<string, string>;
  visible: boolean;
  swatchId: string;
  heightMM: number;
  zMM: number;
  printable: boolean;
  attachId?: string;
  printLayerId?: string;
  printPlacement?:
    | { kind: 'layer'; layerId: string }
    | { kind: 'mixed'; layerIds: string[]; includesUnassigned: boolean }
    | { kind: 'unassigned' | 'unavailable' };
  joinMM?: number;
  disabledClosureFeatureIds?: string[];
  modifiers?: SurfaceModifier[];
  surfaceGraph?: { outputs: { key: string; signature: string }[] };
};
export type CreationDocument = {
  tree?: SceneNode[];
  objects: CreationObject[];
  swatches: Swatch[];
  swatchOwners: Record<string, { id: string; name: string }[]>;
  printStack?: {
    layerHeightMM: number;
    layers: { id: string; name: string }[];
  };
};
export type SceneNode = {
  id: string;
  kind: 'group' | 'shape';
  name: string;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  ownVisible: boolean;
  ownLocked: boolean;
  hiddenBy: string[];
  lockedBy: string[];
  children: SceneNode[];
};
export type SceneRow = CreationObject &
  SceneNode & { depth: number; ancestors: string[] };
export type RegionGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: Point[][] | Point[][][];
};
export type CreationCell = {
  outputRef?: OutputRef;
  key: string;
  objectId: string;
  name?: string;
  painted: boolean;
  color: string;
  geometry: RegionGeometry;
  heightMM: number;
  bottomMM?: number;
  zMM?: number;
  printLayerId?: string;
  mode?: string;
  enabled?: boolean;
  conflict?: boolean;
  from?: Point;
  to?: Point;
  flatOnly?: boolean;
  featureId?: string;
  regionId?: string;
  boundaryPathIds?: string[];
  modifierResult?: { id: string };
  targetTopology?: string;
};
export type Point = [number, number];
export type SceneError = {
  objectId: string;
  message: string;
  kind?: string;
  modifierId?: string;
  pathIds?: string[];
  pending?: boolean;
};
export type Connection = {
  objectId: string;
  pathId: string;
  endpoint: number;
  from?: Point;
  to?: Point;
  coordinates?: Point[];
  featureId?: string;
};
export type ConnectionHighlight = {
  objectId: string;
  pathId?: string;
  featureId?: string;
  from?: Point;
  to?: Point;
  coordinates?: Point[];
};
export type Diagnostic = {
  objectId: string;
  pathId?: string;
  status?: string;
  message?: string;
};
export type CreationScene = Omit<
  ModifierScene,
  'creation' | 'cells' | 'errors' | 'modifierStatus'
> & {
  identities?: {
    paths: Record<string, unknown>;
    cells: Record<string, unknown>;
  };
  creation: CreationDocument;
  cells: CreationCell[];
  errors: SceneError[];
  connections?: Connection[];
  diagnostics: Diagnostic[];
  printLevels?: {
    id: string;
    state: string;
    bottomLayers: number;
    topLayers: number;
    heightLayers: number;
    bottomMM: number;
    topMM: number;
    message?: string;
  }[];
  modifierStatus?: ModifierScene['modifierStatus'];
};
