import { evaluateRegions, previewRegion } from './region-engine.mjs';
import { buildSolid } from './solid-engine.mjs';
import { evaluateCreation, previewCreationBase } from './creation-engine.mjs';
// @ts-ignore Vite emits the WASM alongside the worker.
import wasmURL from 'manifold-3d/manifold.wasm?url';
self.onmessage = async ({ data }) => {
  const { id, action, project, args } = data;
  try {
    const result =
      action === 'creation_base'
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
  } catch (e: any) {
    self.postMessage({ id, error: e.message || String(e) });
  }
};
