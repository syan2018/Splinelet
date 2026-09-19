import type { Point, Project } from '@/lib/project';
import type { TraceSettings } from '@/components/source-editor/trace-editor-state';

export type AgentWorkspaceArgs = { mode: 'trace' | 'faces' | 'relief' };
export type AgentPathArgs = { pathId: string };
export type AgentPathEndArgs = AgentPathArgs & { end: 'start' | 'end' };
export type AgentNodeArgs = AgentPathArgs & { nodeIndex: number };
export type AgentSpanArgs = AgentPathArgs & { curve?: number };
export type AgentPointArgs = AgentPathArgs & {
  curve: number;
  point: 1 | 2;
  position: Point;
};
export type AgentViewArgs =
  | { fit: true }
  | { x: number; y: number; scale: number; fit?: false };
export type AgentExportArgs = { format: 'svg' | 'blender' | 'json' };
export type AgentLoadProjectArgs =
  | { project: Project; filename?: string }
  | { base64: string; filename?: string };
export type AgentVisibilityArgs = { visible: boolean };
export type AgentPathListArgs = { pathIds: string[] };
export type AgentMovePathsArgs = AgentPathListArgs & {
  groupId?: string;
  targetId?: string;
  after?: boolean;
};
export type AgentMergeArgs = {
  firstId: string;
  firstEnd: 'start' | 'end';
  secondId: string;
  secondEnd: 'start' | 'end';
};
export type AgentCreationFocusArgs = { objectId: string };
export type AgentCreationSelectArgs = { cellKeys: string[] };
export type AgentCreationCommandArgs = {
  action: string;
  args?: Record<string, unknown>;
  revision?: number;
};
export type AgentCreationViewArgs = { view: 'flat' | '3d' };
export type AgentCreationExportArgs = { format: string };
export type AgentGroupArgs = {
  action: 'create' | 'rename' | 'assign' | 'visibility' | 'delete';
  id?: string;
  name?: string;
  pathIds?: string[];
  visible?: boolean;
};
export type AgentCreatePathArgs = Partial<TraceSettings> & {
  points: Array<Point | string>;
  name?: string;
  closed?: boolean;
  preview?: boolean;
};

export type AgentCall = (action: string, args?: unknown) => Promise<unknown>;
