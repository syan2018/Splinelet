import { evaluateRegions, previewRegion } from './region-engine.mjs';
import { buildSolid } from './solid-engine.mjs';
import { export3MF } from './three-mf.mjs';
import { evaluateCreation, previewCreationBase } from './creation-engine.mjs';
import wasmURL from 'manifold-3d/manifold.wasm?url';
import type { BambuSlicerTemplate, Project } from './project';

type WorkerRequest = {
  id: number;
  action: string;
  project: Project;
  args: Record<string, unknown> & {
    partId?: string;
    slicerTemplate?: BambuSlicerTemplate | null;
  };
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  const { id, action, project, args } = data;
  try {
    const result =
      action === '3mf'
        ? await export3MF(
            project,
            args.partId,
            { locateFile: () => wasmURL },
            // The JavaScript implementation accepts a validated Bambu template;
            // its inferred declaration only retains the null default value.
            { slicerTemplate: args.slicerTemplate } as never,
          )
        : action === 'creation_base'
          ? previewCreationBase(project, args)
          : action === 'creation'
            ? evaluateCreation(project, args)
            : action === 'regions'
              ? evaluateRegions(project)
              : action === 'preview'
                ? previewRegion(project, args)
                : await buildSolid(project, args.partId, {
                    locateFile: () => wasmURL,
                  });
    self.postMessage({ id, result });
  } catch (error: unknown) {
    self.postMessage({ id, error: errorMessage(error) });
  }
};
