import { evaluateProgram } from '../construction/document-evaluation.mjs';
import { createCommandIdAllocator } from '../editing/command-ids.mjs';
import { createAuthoringCommand } from '../editing/commands/authoring.mjs';
import { childrenOf, effectiveNodeState } from '../scene/hierarchy.mjs';
import { resolveAppearance, sameOutputRef } from '../relief/appearance.mjs';

/** An additional relief is an independent consumer of one region, not a copy
 * of its evaluated polygon or a second writable legacy feature table. */
export function createRegionContribution(
  document,
  target,
  value,
  options,
  context,
) {
  const owner = document.nodes[target.ownerNodeId];
  if (!owner || effectiveNodeState(document, owner.id).locked)
    throw Error('来源部件不存在或已锁定');
  const sourceProgram = document.programs[owner.programId];
  const source = evaluateProgram(document, owner.id).regions;
  if (
    source.status !== 'ready' ||
    !source.value.regions.some((region) => sameOutputRef(region.ref, target))
  )
    throw Error('来源区域已失效');
  const allocate = createCommandIdAllocator(document, context.idFactory);
  const nodeId = allocate(),
    programId = allocate(),
    operatorId = allocate();
  document.nodes[nodeId] = {
    id: nodeId,
    kind: 'shape',
    programId,
    name: options.name || owner.name,
    parentId: null,
    order: childrenOf(document, null).length,
    pose: { translationMM: [0, 0], rotationRad: 0 },
    visible: true,
    locked: false,
  };
  document.programs[programId] = {
    id: programId,
    ownerNodeId: nodeId,
    operators: {
      [operatorId]: {
        id: operatorId,
        type: 'region-reference',
        name: '体块来源',
        enabled: true,
        inputs: {
          input: [
            {
              ...structuredClone(sourceProgram.outputs.regions),
              space: 'world-result',
              transform: [1, 0, 0, 1, 0, 0],
            },
          ],
        },
        params: {
          scope: { kind: 'selected', refs: [structuredClone(target)] },
        },
      },
    },
    outputs: {
      regions: {
        kind: 'port',
        ownerNodeId: nodeId,
        operatorId,
        port: 'regions',
        domain: 'regions',
      },
    },
  };
  const output = evaluateProgram(document, nodeId).regions;
  if (output.status !== 'ready' || output.value.regions.length !== 1)
    throw Error('独立体块来源无法求值');
  const ref = output.value.regions[0].ref;
  const appearance = resolveAppearance(document, owner.id, target);
  if (appearance.status === 'blocked') throw Error('来源区域颜色存在冲突');
  if (appearance.value?.swatchId)
    document.appearances.defaults[nodeId] = {
      swatchId: appearance.value.swatchId,
    };
  let result = createAuthoringCommand({
    kind: 'set-relief',
    target: ref,
    value,
  })(document, context);
  if (options.partId !== undefined)
    result = createAuthoringCommand({
      kind: 'set-manufacturing-part',
      target: ref,
      partId: options.partId,
    })(result.document, context);
  return { document: result.document, target: structuredClone(ref) };
}
