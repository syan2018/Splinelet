export type Id = string;
export type Vec2 = [number, number];
export type Affine2D = [number, number, number, number, number, number];
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type EntityRef =
  | { kind: 'node' | 'datum' | 'parameter' | 'relation' | 'program'; id: Id }
  | { kind: 'path' | 'vertex' | 'edge'; sketchId: Id; id: Id }
  | { kind: 'edge-end'; sketchId: Id; edgeId: Id; end: 'start' | 'end' }
  | OutputRef;
export type NodeRef = { kind: 'node'; id: Id };
export type VertexRef = { kind: 'vertex'; sketchId: Id; id: Id };
export type EdgeRef = { kind: 'edge'; sketchId: Id; id: Id };
export type EdgeEndRef = {
  kind: 'edge-end';
  sketchId: Id;
  edgeId: Id;
  end: 'start' | 'end';
};
export type TargetRef = NodeRef | OutputRef;

export type GroupNode = NodeBase & { kind: 'group' };
export type ShapeNode = NodeBase & { kind: 'shape'; programId: Id };
export type Node = GroupNode | ShapeNode;
export type NodeBase = {
  id: Id;
  name: string;
  parentId: Id | null;
  order: number;
  pose: { translationMM: Vec2; rotationRad: number };
  visible: boolean;
  locked: boolean;
};

export type Vertex = {
  id: Id;
  position:
    | { kind: 'free'; value: Vec2 }
    | { kind: 'relation'; relationId: Id };
};
export type Handle =
  | { kind: 'free'; vector: Vec2 }
  | { kind: 'relation'; relationId: Id };
export type Edge = {
  id: Id;
  startVertexId: Id;
  endVertexId: Id;
  startHandle: Handle;
  endHandle: Handle;
};
export type Path = {
  id: Id;
  name: string;
  edges: { edgeId: Id; reversed: boolean }[];
  visible: boolean;
};
export type Sketch = {
  id: Id;
  ownerNodeId: Id;
  vertices: Record<Id, Vertex>;
  edges: Record<Id, Edge>;
  paths: Record<Id, Path>;
};

export type Scalar =
  | number
  | { kind: 'parameter'; id: Id }
  | {
      kind: 'expression';
      op: 'add' | 'subtract' | 'multiply' | 'divide' | 'negate' | 'sin' | 'cos';
      args: Scalar[];
    };
export type Parameter = {
  id: Id;
  name: string;
  ownerNodeId: Id | null;
  unit: 'mm' | 'rad' | 'count' | 'unitless';
  value: number;
};
export type Datum =
  | {
      id: Id;
      name: string;
      ownerNodeId: Id | null;
      kind: 'point';
      position: [Scalar, Scalar];
    }
  | {
      id: Id;
      name: string;
      ownerNodeId: Id | null;
      kind: 'axis';
      origin: [Scalar, Scalar];
      angleRad: Scalar;
    };
export type PointRef = VertexRef | { kind: 'datum'; id: Id };
export type RelationFrame = {
  space: 'owner-local' | 'world';
  transform: Affine2D;
};
export type Relation =
  | {
      id: Id;
      kind: 'point-on-axis';
      target: VertexRef;
      axisId: Id;
      distance: Scalar;
      frame: RelationFrame;
    }
  | {
      id: Id;
      kind: 'coincident';
      target: VertexRef;
      source: PointRef;
      offset: [Scalar, Scalar];
      frame: RelationFrame;
    }
  | {
      id: Id;
      kind: 'handle-continuity';
      target: EdgeEndRef;
      source: EdgeEndRef;
      mode: 'smooth' | 'symmetric' | 'auto';
      length?: Scalar;
    };

export type PortRef = {
  kind: 'port';
  ownerNodeId: Id;
  operatorId: Id;
  port: string;
  domain: 'curves' | 'regions';
};
export type InputRef =
  | { kind: 'sketch'; sketchId: Id; pathIds?: Id[] }
  | (PortRef & {
      space: 'local-result' | 'world-result';
      transform: Affine2D;
    });
export type OutputRef = {
  kind: 'output';
  ownerNodeId: Id;
  operatorId: Id;
  port: string;
  key: string;
  lineage: string[];
  instances: { operatorId: Id; index: number }[];
};
export type Operator = {
  id: Id;
  type: string;
  name: string;
  enabled: boolean;
  inputs: Record<string, InputRef[]>;
  params: JsonObject;
  outputContract?: {
    version: 1;
    members: {
      port: string;
      key: string;
      lineage: string[];
      topology?: string;
    }[];
  };
};
export type Program = {
  id: Id;
  ownerNodeId: Id;
  operators: Record<Id, Operator>;
  outputs: Partial<Record<'curves' | 'regions', PortRef>>;
};

export type AppearanceAssignment = {
  id: Id;
  target: OutputRef;
  value: { swatchId: Id };
};
export type Appearances = {
  swatches: Record<Id, { id: Id; name: string; color: string }>;
  defaults: Record<Id, { swatchId: Id }>;
  overrides: Record<Id, AppearanceAssignment>;
};
export type ReliefValue = {
  enabled: boolean;
  thickness: { kind: 'mm'; value: number } | { kind: 'layers'; count: number };
  mode: 'add' | 'cut' | 'through';
  placement:
    | { kind: 'free'; zMM: number }
    | { kind: 'attached'; target: NodeRef | OutputRef; offsetMM: number }
    | { kind: 'layer'; layerId: Id; offsetMM: number };
};
export type ReliefDefinitions = {
  defaults: Record<Id, ReliefValue>;
  overrides: Record<
    Id,
    { id: Id; target: OutputRef; value: Partial<ReliefValue> }
  >;
};
export type Manufacturing = {
  layerHeightMM: number;
  layers: Record<Id, { id: Id; name: string }>;
  layerOrder: Id[];
  parts: Record<Id, { id: Id; name: string }>;
  defaultPartId: Id;
  assignments: Record<Id, { id: Id; target: TargetRef; partId: Id }>;
  excluded: TargetRef[];
  slicerTemplate: JsonObject | null;
};
export type Asset = {
  id: Id;
  path: string;
  mediaType: string;
  size: number;
  sha256: string;
};
export type Reference = {
  id: Id;
  assetId: Id;
  name: string;
  pixelWidth: number;
  pixelHeight: number;
  pixelToWorld: Affine2D;
  visible: boolean;
  locked: boolean;
  opacity: number;
};
export type Collection = {
  id: Id;
  name: string;
  members: EntityRef[];
  origin: 'legacy' | 'user';
};
export type DocumentV4 = {
  version: 4;
  id: Id;
  units: 'mm';
  nodes: Record<Id, Node>;
  sketches: Record<Id, Sketch>;
  datums: Record<Id, Datum>;
  parameters: Record<Id, Parameter>;
  relations: Record<Id, Relation>;
  programs: Record<Id, Program>;
  geometrySettings: {
    curveToleranceMM: number;
    joinToleranceMM: number;
    numericTolerance: number;
  };
  appearances: Appearances;
  reliefDefinitions: ReliefDefinitions;
  manufacturing: Manufacturing;
  assets: Record<Id, Asset>;
  references: Record<Id, Reference>;
  collections: Record<Id, Collection>;
};
