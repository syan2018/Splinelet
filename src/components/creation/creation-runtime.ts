import type { BambuSlicerTemplate } from '@/lib/project';
import type { StudioDisplayProject } from '@/lib/editor/studio-display-types';
import type { CurvePreview, ModifierScene } from '@/lib/modifier-types';
import type { InputRef, OutputRef } from '@/lib/document/types';
import type { StageResult } from '@/lib/construction/types';

export type ModifierInputRepairRequest = {
  ownerNodeId: string;
  operatorId: string;
  input: string;
  index: number;
  reference: InputRef;
};
export type ModifierInputRepair = {
  preview: ModifierScene['modifierStatus'];
  ports: Record<string, StageResult>;
  commit: () => StudioDisplayProject;
  cancel: () => void;
};

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
  bakeModifierSnapshot: (
    project: StudioDisplayProject,
    ownerNodeId: string,
    modifierId: string,
  ) => StudioDisplayProject;
  readPostChain: (
    project: StudioDisplayProject,
    ownerNodeId: string,
  ) => {
    id: string;
    label: string;
    status: string;
    lastRevision: number | null;
    diagnostics: { message: string }[];
  }[];
  readRegionSelections: (
    project: StudioDisplayProject,
    ownerNodeId: string,
    modifierId: string,
  ) => {
    geometryStage: StageResult;
    definitions: {
      definitionId: string;
      status: string;
      candidates: {
        ref: OutputRef;
        label: string;
        occupiedByDefinitionId: string | null;
      }[];
    }[];
  };
  prepareRegionSelectionRepair: (
    request: { definitionId: string; candidateRef: OutputRef },
    context: { project: StudioDisplayProject },
  ) => Promise<ModifierInputRepair>;
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
  readRevision: (project: StudioDisplayProject) => string;
  readModifierStatus: (
    project: StudioDisplayProject,
  ) => ModifierScene['modifierStatus'];
  readModifierInputs: (
    project: StudioDisplayProject,
    ownerNodeId: string,
    modifierId: string,
  ) => {
    revision: number;
    outputs: string[];
    inputs: {
      input: string;
      index: number;
      reference: InputRef | null;
      label: string;
      options: { label: string; reference: InputRef }[];
      diagnostics: { message: string; code: string }[];
    }[];
  };
  readModifierSnapshot: (
    project: StudioDisplayProject,
    modifierId: string,
    port: string,
  ) => {
    current: StageResult | null;
    lastSuccessful: { revision: number; stage: StageResult } | null;
    freshness: string;
  } | null;
  prepareModifierInputRepair: (
    request: ModifierInputRepairRequest,
    context: { project: StudioDisplayProject },
  ) => Promise<ModifierInputRepair>;
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
