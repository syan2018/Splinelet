import type { Point } from '@/lib/project';

export type StudioDisplayPoint = Readonly<Point>;
export type StudioDisplayCubic = readonly [
  StudioDisplayPoint,
  StudioDisplayPoint,
  StudioDisplayPoint,
  StudioDisplayPoint,
];

/** Immutable source path projection used by the established Studio shell. */
export type StudioDisplayPath = Readonly<{
  id: string;
  name: string;
  color: string;
  curves: readonly StudioDisplayCubic[];
  start: StudioDisplayPoint;
  closed: boolean;
  visible: boolean;
  locked: boolean;
  quality: number;
  anchors: readonly StudioDisplayPoint[];
  groupId?: string;
  groupIds?: readonly string[];
  nodeModes: readonly ('corner' | 'smooth' | 'symmetric')[];
  fitting?: 'single';
  fitError?: number;
  identity: Readonly<{
    pathId: string;
    anchorIds: readonly string[];
    edgeIds: readonly string[];
    handleIds: readonly (readonly [string, string])[];
  }>;
}>;

export type StudioDisplayGroup = Readonly<{ id: string; name: string }>;

export type StudioImportIssue = Readonly<
  Record<string, unknown> & {
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    ref?:
      | string
      | Readonly<
          Record<string, unknown> & {
            id?: string;
            name?: string;
          }
        >
      | null;
  }
>;

/** Legacy import diagnostics are presentation data and never enter V4 storage. */
export type StudioImportReport = Readonly<
  Record<string, unknown> & {
    issues: readonly StudioImportIssue[];
  }
>;

export type StudioDisplayCreationObject = Readonly<{
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  pathIds: readonly string[];
  roles: Readonly<Record<string, string>>;
  visible: boolean;
  locked: boolean;
  swatchId: string | null;
  heightMM: number | null;
  zMM: number | null;
  attachId: string;
  printLayerId: string;
  printable: boolean;
  partId: string | null;
  joinMM: number | null;
  printPlacement:
    | Readonly<{ kind: 'layer'; layerId: string }>
    | Readonly<{
        kind: 'mixed';
        layerIds: readonly string[];
        includesUnassigned: boolean;
      }>
    | Readonly<{ kind: 'unassigned' | 'unavailable' }>;
}>;

export type StudioDisplayCreation = Readonly<{
  objects: readonly StudioDisplayCreationObject[];
  tree?: readonly StudioDisplaySceneNode[];
  swatches: readonly Readonly<{ id: string; name: string; color: string }>[];
  swatchOwners: Readonly<
    Record<string, readonly Readonly<{ id: string; name: string }>[]>
  >;
  printStack?: Readonly<{
    layerHeightMM: number;
    layers: readonly Readonly<{ id: string; name: string }>[];
  }>;
}>;

export type StudioDisplaySceneNode = Readonly<{
  id: string;
  kind: 'group' | 'shape';
  name: string;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
  ownVisible: boolean;
  ownLocked: boolean;
  hiddenBy: readonly string[];
  lockedBy: readonly string[];
  children: readonly StudioDisplaySceneNode[];
}>;

/**
 * Immutable V4 projection consumed by the established Studio shell.
 *
 * It deliberately has no legacy file-format version: a display handle is
 * issued by the V4 runtime and is never accepted by legacy encoders.
 */
export type StudioDisplayProject = Readonly<{
  version: 4;
  image: string;
  imageName: string;
  width: number;
  height: number;
  widthMM: number;
  depthMM: number;
  groups: readonly StudioDisplayGroup[];
  paths: readonly StudioDisplayPath[];
  creation: StudioDisplayCreation;
}>;
