import type { Project } from '@/lib/project';

export type CreationRuntimeContext = {
  project: Project;
  scene: unknown;
};

/** A normal command is committed only when the workspace calls commit(). */
export type CreationCommandPlan = {
  project: Project;
  commit: () => Project;
};

/**
 * Prepared commands expose a prospective display project for evaluation.
 * token belongs to the runtime and must never be interpreted by the UI.
 */
export type PreparedCreationCommand = {
  project: Project;
  token: unknown;
};

export type BoundCreationEvaluation = {
  project: Project;
  scene: unknown;
};

/**
 * Injectable data boundary for the unchanged CreationWorkspace UI. Project
 * values returned here are read-only display projections; callers must never
 * treat them as an alternate writable source model.
 */
export type CreationRuntime = {
  readCreationDocument: (project: Project) => unknown;
  evaluate: (
    action: string,
    args: Record<string, unknown>,
    project: Project,
  ) => Promise<unknown>;
  bindEvaluation: (project: Project, scene: unknown) => BoundCreationEvaluation;
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
  ) => Project;
  commitPreparedDisplay: (
    project: Project,
    context: CreationRuntimeContext,
  ) => Project;
  setSlicerTemplate: (
    template: unknown,
    context: CreationRuntimeContext,
  ) => Project;
  attachNewPath: (
    path: { id: string },
    context: CreationRuntimeContext,
  ) => unknown;
};
