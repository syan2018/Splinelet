import type { BambuSlicerTemplate } from '@/lib/project';
import type { StudioDisplayProject } from '@/lib/editor/studio-display-types';
import type { CurvePreview } from '@/lib/modifier-types';

export type CreationRuntimeContext = {
  project: StudioDisplayProject;
  scene: unknown;
};

/** A normal command is committed only when the workspace calls commit(). */
export type CreationCommandPlan = {
  project: StudioDisplayProject;
  commit: () => StudioDisplayProject;
};

/**
 * Prepared commands expose a prospective display project for evaluation.
 * token belongs to the runtime and must never be interpreted by the UI.
 */
export type PreparedCreationCommand = {
  project: StudioDisplayProject;
  token: unknown;
};

export type BoundCreationEvaluation = {
  project: StudioDisplayProject;
  scene: unknown;
};

/**
 * Injectable data boundary for the unchanged CreationWorkspace UI. Display
 * values returned here are read-only projections; callers must never
 * treat them as an alternate writable source model.
 */
export type CreationRuntime = {
  readOutputSettings: (project: StudioDisplayProject) => {
    parts: { id: string; name: string }[];
    defaultPartId: string;
    slicerTemplate: BambuSlicerTemplate | null;
  };
  readCurvePreviews: (project: StudioDisplayProject) => CurvePreview[];
  readEvaluatedCurvePreviews?: (
    project: StudioDisplayProject,
  ) => CurvePreview[] | null;
  readCreationDocument: (project: StudioDisplayProject) => unknown;
  evaluate: (
    action: string,
    args: Record<string, unknown>,
    project: StudioDisplayProject,
  ) => Promise<unknown>;
  bindEvaluation: (
    project: StudioDisplayProject,
    scene: unknown,
  ) => BoundCreationEvaluation;
  command: (
    action: string,
    args: Record<string, unknown>,
    context: CreationRuntimeContext,
  ) => CreationCommandPlan;
  prepare: (
    action: string,
    args: Record<string, unknown>,
    context: CreationRuntimeContext,
  ) => Promise<PreparedCreationCommand>;
  commitPrepared: (
    prepared: PreparedCreationCommand,
    context: CreationRuntimeContext,
  ) => StudioDisplayProject;
  commitPreparedDisplay: (
    project: StudioDisplayProject,
    context: CreationRuntimeContext,
  ) => StudioDisplayProject;
  setSlicerTemplate: (
    template: unknown,
    context: CreationRuntimeContext,
  ) => StudioDisplayProject;
  attachNewPath: (
    path: { id: string },
    context: CreationRuntimeContext,
  ) => unknown;
};
