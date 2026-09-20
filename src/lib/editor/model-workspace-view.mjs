import { projectWorkspaceView } from './workspace-view.mjs';
import { resolveReliefDefinition } from '../relief/resolve.mjs';
import { unresolvedAssignments } from '../relief/assignments.mjs';
import { partForRelief } from '../manufacturing/parts.mjs';
import { readGeometry } from '../region-engine.mjs';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

/** Advanced face/relief workspace read boundary. An OutputRef is the selection
 * identity, never a writable legacy region recipe. Authored relief settings
 * remain available when disabled or when placement cannot be evaluated.
 * Callers must pass the captured evaluation of this exact editor state.
 */
export function projectModelWorkspaceView(editorState, evaluated, frame) {
  const workspace = projectWorkspaceView(editorState, evaluated, frame);
  const document = editorState.previewId
    ? editorState.preview.document
    : editorState.document;
  const regions = workspace.creation.cells.map((cell) => {
    const geometry = readGeometry(cell.geometry);
    let holes = 0;
    for (let index = 0; index < geometry.getNumGeometries(); index++)
      holes += geometry.getGeometryN(index).getNumInteriorRing();
    let part;
    try {
      part = {
        status: 'ready',
        id: partForRelief(document, { ref: cell.outputRef }),
      };
    } catch (error) {
      part = { status: 'blocked', message: error.message };
    }
    return {
      ...cell,
      id: cell.key,
      areaMM2: geometry.getArea(),
      components: geometry.getNumGeometries(),
      holes,
      authoredRelief: resolveReliefDefinition(
        document,
        cell.objectId,
        cell.outputRef,
      ),
      part,
    };
  });
  const published = regions.map((region) => ({ ref: region.outputRef }));
  // Invalid targets must remain visible for repair rather than being silently
  // dropped with the failed geometry. Their persisted identity is unchanged.
  const unresolved = {
    appearance: unresolvedAssignments(
      published,
      Object.values(document.appearances.overrides),
    ),
    relief: unresolvedAssignments(
      published,
      Object.values(document.reliefDefinitions.overrides),
    ),
  };
  return freeze(
    structuredClone({
      ...workspace,
      regions,
      unresolved,
      geometrySettings: document.geometrySettings,
      parts: Object.values(document.manufacturing.parts),
      defaultPartId: document.manufacturing.defaultPartId,
      layers: document.manufacturing.layerOrder.map(
        (id) => document.manufacturing.layers[id],
      ),
      layerHeightMM: document.manufacturing.layerHeightMM,
      slicerTemplate: document.manufacturing.slicerTemplate,
    }),
  );
}
