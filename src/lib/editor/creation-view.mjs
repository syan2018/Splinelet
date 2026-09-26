import { childrenOf, effectiveNodeState } from '../scene/hierarchy.mjs';
import { transformPoint, worldMatrix } from '../scene/transforms.mjs';
import { outputIdentity, resolveAppearance } from '../relief/appearance.mjs';
import { isExcluded } from '../manufacturing/parts.mjs';
import { resolveReliefDefinition } from '../relief/resolve.mjs';
import { readyReliefMembers } from '../evaluation/branch-stages.mjs';
import { projectJoinEndpoints } from './join-view.mjs';
import { sourcePathId } from './source-view.mjs';
import { orderedSourcePaths } from '../geometry/source-order.mjs';
import { projectModifierControls } from './modifier-view.mjs';
import { projectPartitionConnections } from './connection-intents.mjs';
import {
  regionPathMemberships,
  regionSourcePaths,
} from '../editing/region-drawing.mjs';
import {
  curveModifierAddCapability,
  programModifierCapabilities,
} from '../editing/commands/program-modifiers.mjs';
import {
  aggregatePrintPlacements,
  printPlacementFor,
} from './print-placement.mjs';

const clone = (value) => structuredClone(value);
const absent = (domain) => ({
  domain,
  status: 'absent',
  diagnostics: [],
  dependencies: [],
});
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const mapCoordinates = (coordinates, matrix) =>
  Array.isArray(coordinates) &&
  coordinates.length === 2 &&
  coordinates.every(Number.isFinite)
    ? transformPoint(matrix, coordinates)
    : Array.isArray(coordinates)
      ? coordinates.map((item) => mapCoordinates(item, matrix))
      : coordinates;
const uniqueValue = (values) => {
  const present = values.filter((value) => value !== null);
  return present.length && present.every((value) => value === present[0])
    ? present[0]
    : null;
};
const ownerStage = (stage, ownerNodeId) =>
  stage?.branches
    ? stage.branches.find((branch) => branch.ownerNodeId === ownerNodeId)
    : stage;
const cellEvaluation = ({
  definition,
  appearance,
  excluded,
  reliefStage,
  placementStage,
  relief,
  placed,
}) => {
  if (definition.status === 'blocked' || appearance.status === 'blocked')
    return 'blocked';
  if (!definition.value.enabled) return 'disabled';
  if (excluded) return 'excluded';
  if (placed) return 'ready';
  if (reliefStage?.status === 'blocked' || placementStage?.status === 'blocked')
    return 'blocked';
  if (
    !reliefStage ||
    reliefStage.status === 'absent' ||
    !placementStage ||
    placementStage.status === 'absent'
  )
    return 'unevaluated';
  return relief ? 'unplaced' : 'blocked';
};

/**
 * Stable, lossless cell identity. The encoded value includes the complete
 * OutputRef authority used by assignments: owner, operator, port, key,
 * instances and lineage.
 */
export const creationCellKey = (ref) => `output:${outputIdentity(ref)}`;

const currentPublishedStage = (snapshot, node, domain) => {
  const published = snapshot?.planar?.published;
  if (published && typeof published === 'object')
    return published[`${node.id}:${domain}`] || absent(domain);
  // A full evaluateDocument result also exposes the published domain arrays.
  // This fallback can identify ready/empty results only when their frame keeps
  // the owner. It never consults an earlier snapshot or an intermediate port.
  const candidates = Array.isArray(snapshot?.[domain]) ? snapshot[domain] : [];
  return (
    candidates.find((stage) => stage?.value?.frame?.ownerNodeId === node.id) ||
    absent(domain)
  );
};

const stageDiagnostics = (stage, objectId, source) =>
  (stage?.diagnostics || []).map((item) => ({
    ...clone(item),
    objectId: item?.ref?.ownerNodeId || objectId,
    source,
    status: stage.status,
  }));

const indexMembers = (stage, label, diagnostics) => {
  const result = new Map();
  const ambiguous = new Set();
  for (const member of readyReliefMembers(stage)) {
    const key = outputIdentity(member.ref);
    if (ambiguous.has(key)) continue;
    if (result.has(key)) {
      diagnostics.push({
        objectId: member.ref?.ownerNodeId || null,
        status: 'blocked',
        severity: 'error',
        kind: 'ambiguous-output',
        message: `${label} 含重复 OutputRef`,
        ref: clone(member.ref),
        source: label,
      });
      result.delete(key);
      ambiguous.add(key);
    } else result.set(key, member);
  }
  return result;
};

const shapesInSceneOrder = (document, parentId = null) =>
  childrenOf(document, parentId).flatMap((node) =>
    node.kind === 'shape' ? [node] : shapesInSceneOrder(document, node.id),
  );

const nodeTree = (document, parentId = null) =>
  childrenOf(document, parentId).map((node) => {
    const state = effectiveNodeState(document, node.id);
    return {
      ref: { kind: 'node', id: node.id },
      id: node.id,
      kind: node.kind,
      name: node.name,
      parentId: node.parentId,
      order: node.order,
      pose: clone(node.pose),
      visible: state.visible,
      locked: state.locked,
      ownVisible: node.visible,
      ownLocked: node.locked,
      hiddenBy: clone(state.hiddenBy),
      lockedBy: clone(state.lockedBy),
      children: node.kind === 'group' ? nodeTree(document, node.id) : [],
    };
  });

const stageState = (curveStage, regionStage) => {
  const stages = [curveStage, regionStage];
  if (stages.some((stage) => stage.status === 'blocked')) return 'blocked';
  if (stages.some((stage) => stage.status === 'ready')) return 'ready';
  if (stages.some((stage) => stage.status === 'empty')) return 'empty';
  return 'absent';
};

const orderedProgramOperators = (program) => {
  const result = [];
  const seen = new Set();
  const visitReference = (reference) => {
    if (reference?.kind === 'port')
      visit(program.operators[reference.operatorId]);
  };
  const visit = (operator) => {
    if (!operator || seen.has(operator.id)) return;
    seen.add(operator.id);
    for (const references of Object.values(operator.inputs || {}))
      for (const reference of references) visitReference(reference);
    result.push(operator);
  };
  visitReference(program.outputs.regions);
  visitReference(program.outputs.curves);
  for (const operator of Object.values(program.operators)) visit(operator);
  return result;
};

const operatorStatus = (document, snapshot, node) => {
  const program = document.programs[node.programId];
  if (!program) return [];
  return orderedProgramOperators(program)
    .filter(
      (operator) =>
        operator.authoring?.phase !== 'drawing' &&
        !['source', 'curve-collect', 'curve-filter', 'region-collect'].includes(
          operator.type,
        ),
    )
    .map((operator) => {
      const component =
        snapshot?.planar?.components?.[`operator:${operator.id}`];
      const stages = Object.values(component?.ports || {});
      const diagnostics = stages
        .flatMap((stage) => stage.diagnostics || [])
        .filter((item) => item.severity !== 'info');
      const message = [...new Set(diagnostics.map((item) => item.message))]
        .filter(Boolean)
        .join('；');
      const blocked = stages.some((stage) => stage.status === 'blocked');
      return {
        objectId: node.id,
        modifierId: operator.id,
        type: operator.type,
        name: operator.name,
        enabled: operator.enabled,
        controls: {
          ...projectModifierControls(document, node.id, operator.id),
          ...(operator.type === 'join' && {
            endpoints: projectJoinEndpoints(
              document,
              snapshot?.planar?.components?.[
                `operator:${operator.inputs.input?.[0]?.operatorId}`
              ]?.ports?.curves,
            ),
          }),
        },
        structure: programModifierCapabilities(document, node.id, operator.id),
        status: blocked
          ? 'blocked'
          : stages.some((stage) => stage.status === 'ready')
            ? 'ready'
            : stages.some((stage) => stage.status === 'empty')
              ? 'empty'
              : operator.enabled
                ? 'absent'
                : 'disabled',
        inputOptions: [],
        ...(message ? { note: message } : {}),
        ...(blocked ? { error: message || '此步骤无法生成结果' } : {}),
      };
    });
};

const objectManufacturing = (document, node, diagnostics, errors) => {
  const excluded = document.manufacturing.excluded.some(
    (target) => target.kind === 'node' && target.id === node.id,
  );
  const assignments = Object.values(document.manufacturing.assignments).filter(
    (assignment) =>
      assignment.target.kind === 'node' && assignment.target.id === node.id,
  );
  if (assignments.length > 1) {
    const message = '同一 Shape 存在多个制造 Part 赋值';
    diagnostics.push({
      objectId: node.id,
      status: 'blocked',
      severity: 'error',
      kind: 'conflicting-assignment',
      message,
      ref: { kind: 'node', id: node.id },
      source: 'manufacturing',
    });
    errors.push({
      objectId: node.id,
      message,
      kind: 'conflicting-assignment',
      pending: false,
    });
  }
  return {
    printable: !excluded,
    partId:
      assignments.length === 1
        ? assignments[0].partId
        : assignments.length
          ? null
          : document.manufacturing.defaultPartId,
  };
};

/**
 * Project a current V4 evaluation into a read-only CreationWorkspace-shaped
 * view. This is a view DTO only: it contains no writable legacy Project and
 * never compiles or substitutes legacy geometry.
 */
export function projectCreationView(document, snapshot) {
  if (document?.version !== 4) throw Error('creation view 需要 V4 Document');
  if (!snapshot || typeof snapshot !== 'object')
    throw Error('creation view 需要当前 evaluateDocument snapshot');

  const connectionView = projectPartitionConnections(document, snapshot);
  const diagnostics = [...connectionView.diagnostics];
  const errors = [];
  const cells = [];
  const identities = { objects: {}, cells: {}, paths: {}, operators: {} };
  const shapes = shapesInSceneOrder(document);

  const reliefMembers = indexMembers(snapshot.relief, 'relief', diagnostics);
  const placedMembers = indexMembers(
    snapshot.placedRelief,
    'placed-relief',
    diagnostics,
  );
  for (const [name, stage] of [
    ['relief', snapshot.relief],
    ['placed-relief', snapshot.placedRelief],
  ]) {
    diagnostics.push(...stageDiagnostics(stage, null, name));
    if (stage?.status === 'blocked')
      for (const item of stage.diagnostics || [])
        errors.push({
          objectId: item?.ref?.ownerNodeId || null,
          message: item.message || `${name} 求值被阻断`,
          kind: item.kind || item.code || 'evaluation',
          pending: false,
        });
  }

  const objectStages = new Map();
  for (const node of shapes) {
    identities.objects[node.id] = { kind: 'node', id: node.id };
    const curveStage = currentPublishedStage(snapshot, node, 'curves');
    const regionStage = currentPublishedStage(snapshot, node, 'regions');
    objectStages.set(node.id, {
      curves: curveStage.status,
      regions: regionStage.status,
      state: stageState(curveStage, regionStage),
    });
    for (const [domain, stage] of [
      ['curves', curveStage],
      ['regions', regionStage],
    ]) {
      diagnostics.push(...stageDiagnostics(stage, node.id, domain));
      if (stage.status === 'blocked')
        errors.push({
          objectId: node.id,
          message:
            (stage.diagnostics || [])
              .map((item) => item.message)
              .filter(Boolean)
              .join('；') || `${domain} 求值被阻断`,
          kind: 'evaluation',
          pending: false,
        });
    }
    if (regionStage.status !== 'ready') continue;
    const matrix = worldMatrix(document, node.id);
    for (const region of regionStage.value?.regions || []) {
      const ref = clone(region.ref);
      const identity = outputIdentity(ref);
      const key = creationCellKey(ref);
      const relief = reliefMembers.get(identity) || null;
      const placed = placedMembers.get(identity) || null;
      const definition = resolveReliefDefinition(document, node.id, ref);
      const appearance = resolveAppearance(document, node.id, ref);
      const excluded = isExcluded(document, { ref });
      diagnostics.push(...stageDiagnostics(appearance, node.id, 'appearance'));
      if (appearance.status === 'blocked')
        errors.push(
          ...appearance.diagnostics.map((item) => ({
            objectId: node.id,
            message: item.message,
            kind: item.kind || 'appearance',
            pending: false,
          })),
        );
      if (Object.hasOwn(identities.cells, key)) {
        diagnostics.push({
          objectId: node.id,
          status: 'blocked',
          severity: 'error',
          kind: 'ambiguous-output',
          message: 'Creation cell key 重复',
          ref,
          source: 'creation-view',
        });
        errors.push({
          objectId: node.id,
          message: 'Creation cell key 重复',
          kind: 'ambiguous-output',
          pending: false,
        });
        continue;
      }
      identities.cells[key] = ref;
      const geometry = placed?.geometry
        ? clone(placed.geometry)
        : {
            ...clone(region.geometry),
            coordinates: mapCoordinates(region.geometry.coordinates, matrix),
          };
      cells.push({
        key,
        outputRef: ref,
        objectId: node.id,
        name: node.name,
        painted: definition.status === 'ready' && definition.value.enabled,
        enabled: definition.status === 'ready' && definition.value.enabled,
        flatOnly: !placed,
        evaluation: cellEvaluation({
          definition,
          appearance,
          excluded,
          relief,
          placed,
          reliefStage: ownerStage(snapshot.relief, node.id),
          placementStage: ownerStage(snapshot.placedRelief, node.id),
        }),
        excluded,
        color: appearance.status === 'ready' ? appearance.value.color : null,
        swatchId:
          appearance.status === 'ready' ? appearance.value.swatchId : null,
        geometry,
        heightMM: placed?.mm ?? null,
        bottomMM: placed?.zBase ?? null,
        zMM: placed?.zBase ?? null,
        topMM: placed?.zTop ?? null,
        partId: placed?.partId ?? null,
        thickness: relief ? clone(relief.thickness) : null,
        placement: relief ? clone(relief.placement) : null,
        printLayerId:
          relief?.placement?.kind === 'layer' ? relief.placement.layerId : null,
        mode: relief?.mode ?? null,
        regionId: key,
      });
    }
  }

  const orderedPaths = orderedSourcePaths(document);
  const objects = shapes.map((node) => {
    const ownedPaths = orderedPaths.filter(
      ({ sketch }) => sketch.ownerNodeId === node.id,
    );
    const pathIds = ownedPaths.map(({ sketch, path }) =>
      sourcePathId(sketch.id, path.id),
    );
    for (const { sketch, path } of ownedPaths)
      identities.paths[sourcePathId(sketch.id, path.id)] = {
        kind: 'path',
        sketchId: sketch.id,
        id: path.id,
      };
    const program = document.programs[node.programId];
    const regionSources = new Set(
      regionSourcePaths(document, node.id).map((ref) =>
        sourcePathId(ref.sketchId, ref.id),
      ),
    );
    for (const operator of Object.values(program?.operators || {}))
      identities.operators[operator.id] = {
        kind: 'operator',
        ownerNodeId: node.id,
        id: operator.id,
      };
    const state = effectiveNodeState(document, node.id);
    const objectCells = cells.filter((cell) => cell.objectId === node.id);
    const placedCells = objectCells.filter(
      (cell) => cell.enabled && cell.heightMM !== null,
    );
    const placements = objectCells
      .map((cell) => cell.placement)
      .filter((placement) => placement !== null);
    if (
      !placements.length &&
      document.reliefDefinitions.defaults[node.id]?.placement
    )
      placements.push(
        clone(document.reliefDefinitions.defaults[node.id].placement),
      );
    const printPlacement = aggregatePrintPlacements(
      placements.map(printPlacementFor),
      document.manufacturing.layerOrder,
    );
    const manufacturing = objectManufacturing(
      document,
      node,
      diagnostics,
      errors,
    );
    const modifierAdd = curveModifierAddCapability(
      document,
      node.id,
      snapshot?.planar || snapshot || {},
    );
    return {
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      order: node.order,
      pose: clone(node.pose),
      pathIds,
      joinMM: uniqueValue(
        Object.values(document.programs[node.programId].operators)
          .filter((operator) => operator.type === 'partition')
          .map((operator) => operator.params.endpointJoin?.toleranceMM ?? 0),
      ),
      modifierAdd: {
        types: modifierAdd.enabled
          ? [
              'curve_mirror',
              'curve_array',
              'join',
              ...(!program.outputs.regions ? ['fill'] : []),
            ]
          : [],
        reason: modifierAdd.reason,
        endpoints: projectJoinEndpoints(
          document,
          currentPublishedStage(snapshot, node, 'curves'),
        ),
      },
      roles: Object.fromEntries(
        ownedPaths.flatMap(({ sketch, path }) => {
          const id = sourcePathId(sketch.id, path.id);
          const memberships = regionPathMemberships(document, {
            kind: 'path',
            sketchId: sketch.id,
            id: path.id,
          });
          const roles = [
            ...new Set(
              memberships.filter((use) => use.included).map((use) => use.role),
            ),
          ];
          if (roles.length === 1) return [[id, roles[0]]];
          if (!roles.length && (memberships.length || !regionSources.has(id)))
            return [[id, 'guide']];
          return [];
        }),
      ),
      visible: state.visible,
      locked: state.locked,
      swatchId: document.appearances.defaults[node.id]?.swatchId ?? null,
      heightMM: uniqueValue(placedCells.map((cell) => cell.heightMM)),
      zMM: placedCells.length
        ? Math.min(...placedCells.map((cell) => cell.bottomMM))
        : placements.length === 1
          ? placements[0].kind === 'free'
            ? placements[0].zMM
            : placements[0].offsetMM
          : null,
      attachId:
        uniqueValue(
          placements.map((placement) =>
            placement.kind === 'attached' && placement.target.kind === 'node'
              ? placement.target.id
              : '',
          ),
        ) ?? '',
      // Keep the historical scalar for consumers that have not adopted the
      // explicit summary. It intentionally remains blank for every non-single
      // state, as it did before this projection gained printPlacement.
      printLayerId:
        printPlacement.kind === 'layer' ? printPlacement.layerId : '',
      printPlacement,
      printable: manufacturing.printable,
      partId: manufacturing.partId,
      evaluation: clone(objectStages.get(node.id)),
    };
  });

  const objectBottoms = Object.fromEntries(
    objects
      .filter((object) => object.zMM !== null)
      .map((object) => [object.id, object.zMM]),
  );
  const modifierStatus = shapes.flatMap((node) =>
    operatorStatus(document, snapshot, node),
  );
  const layers = document.manufacturing.layerOrder.map((id) => ({
    id,
    name: document.manufacturing.layers[id].name,
  }));
  return freeze({
    creation: {
      objects,
      tree: nodeTree(document),
      // Use authored references, including currently unresolved outputs, so
      // the delete dialog agrees with the canonical resource command.
      swatchOwners: Object.fromEntries(
        Object.keys(document.appearances.swatches).map((id) => {
          const ownerIds = new Set([
            ...Object.entries(document.appearances.defaults)
              .filter(([, value]) => value.swatchId === id)
              .map(([ownerId]) => ownerId),
            ...Object.values(document.appearances.overrides)
              .filter((item) => item.value.swatchId === id)
              .map((item) => item.target.ownerNodeId),
          ]);
          return [
            id,
            [...ownerIds].map((ownerId) => ({
              id: ownerId,
              name: document.nodes[ownerId]?.name || '已失效部件',
            })),
          ];
        }),
      ),
      swatches: Object.values(document.appearances.swatches)
        .map(clone)
        .sort((left, right) => left.id.localeCompare(right.id)),
      ...(layers.length
        ? {
            printStack: {
              layerHeightMM: document.manufacturing.layerHeightMM,
              layers,
            },
          }
        : {}),
    },
    cells,
    errors,
    diagnostics,
    modifierModel: 'program',
    modifierStatus,
    connections: connectionView.connections,
    closures: [],
    printLevels: [],
    objectBottoms,
    tree: nodeTree(document),
    identities,
  });
}
