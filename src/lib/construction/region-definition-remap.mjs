const clone = (value) => structuredClone(value);

const mapId = (id, idMap) => idMap[id] || id;

const mapBasisId = (id, pathIdMap, basisIdMap) =>
  pathIdMap[id] || basisIdMap[id] || id;

const remapInstances = (instances, idMap) =>
  (instances || []).map((instance) => ({
    ...clone(instance),
    operatorId: mapId(instance.operatorId, idMap),
  }));

/** V5 persistent region references are typed records. Their definition key is
 * deliberately an opaque ID: unlike V4 encoded identities it is never parsed
 * or string-rewritten. */
export function remapV5RegionOutputRef(
  ref,
  { idMap = {}, definitionIdMap = {} } = {},
) {
  if (ref?.kind !== 'output') throw Error('V5 区域引用必须是 OutputRef');
  return {
    ...clone(ref),
    ownerNodeId: mapId(ref.ownerNodeId, idMap),
    operatorId: mapId(ref.operatorId, idMap),
    key: definitionIdMap[ref.key] || ref.key,
    lineage: clone(ref.lineage || []),
    instances: remapInstances(ref.instances, idMap),
  };
}

const remapUse = (use, maps) => ({
  ...clone(use),
  ...(typeof use.operatorId === 'string'
    ? { operatorId: mapId(use.operatorId, maps.idMap) }
    : {}),
  ...(typeof use.sketchId === 'string'
    ? { sketchId: mapId(use.sketchId, maps.idMap) }
    : {}),
  ...(typeof use.pathId === 'string'
    ? { pathId: mapBasisId(use.pathId, maps.pathIdMap, maps.basisIdMap) }
    : {}),
  ...(typeof use.basisId === 'string'
    ? { basisId: mapBasisId(use.basisId, maps.pathIdMap, maps.basisIdMap) }
    : {}),
  ...(Array.isArray(use.instances)
    ? { instances: remapInstances(use.instances, maps.idMap) }
    : {}),
});

const remapSelectorSource = (use, maps) => {
  const result = remapUse(use, maps);
  if (use.kind === 'generated-offset')
    return {
      ...result,
      parent: remapV5RegionOutputRef(use.parent, maps),
    };
  if (use.kind === 'generated-between-join')
    return {
      ...result,
      ends: use.ends.map((end) =>
        end.map((endpoint) => ({
          ...clone(endpoint),
          path: {
            ...clone(endpoint.path),
            sketchId: mapId(endpoint.path.sketchId, maps.idMap),
            pathId: mapBasisId(
              endpoint.path.pathId,
              maps.pathIdMap,
              maps.basisIdMap,
            ),
          },
          instances: remapInstances(endpoint.instances, maps.idMap),
        })),
      ),
    };
  return result;
};

const remapEvent = (event, maps) => ({
  ...clone(event),
  branches: event.branches.map((branch) => ({
    ...clone(branch),
    use: remapSelectorSource(branch.use, maps),
  })),
});

const remapCellRing = (ring, maps) => {
  if (!Array.isArray(ring)) throw Error('V5 cell selector 环无效');
  return ring.map((run) => {
    if (!Array.isArray(run?.sources)) throw Error('V5 cell selector 来源无效');
    return {
      ...clone(run),
      sources: run.sources.map((source) => {
        if (!source?.use || typeof source.use !== 'object')
          throw Error('V5 cell selector use 无效');
        return {
          ...clone(source),
          use: remapSelectorSource(source.use, maps),
        };
      }),
      ...(run.closed
        ? {}
        : {
            start: remapEvent(run.start, maps),
            end: remapEvent(run.end, maps),
          }),
    };
  });
};

export function remapV5RegionSelector(
  selector,
  { idMap = {}, definitionIdMap = {}, pathIdMap = {}, basisIdMap = {} } = {},
) {
  if (!selector || typeof selector !== 'object')
    throw Error('V5 region selector 无效');
  const maps = { idMap, definitionIdMap, pathIdMap, basisIdMap };
  if (selector.kind === 'cell')
    return {
      ...clone(selector),
      outer: remapCellRing(selector.outer, maps),
      holes: (selector.holes || []).map((ring) => remapCellRing(ring, maps)),
    };
  if (selector.kind === 'result') {
    if (selector.parent?.kind === 'output')
      return {
        ...clone(selector),
        parent: remapV5RegionOutputRef(selector.parent, maps),
        ...(Array.isArray(selector.instances)
          ? { instances: remapInstances(selector.instances, idMap) }
          : {}),
      };
    if (selector.path?.kind === 'path')
      return {
        ...clone(selector),
        path: {
          ...clone(selector.path),
          sketchId: mapId(selector.path.sketchId, idMap),
          id: mapId(selector.path.id, idMap),
        },
        instances: remapInstances(selector.instances, idMap),
      };
    return clone(selector);
  }
  throw Error('未知 V5 region selector');
}

export function planV5RegionDefinitionCopy(document, ownerNodeIds, allocate) {
  if (document.version !== 5) return { definitions: [], definitionIdMap: {} };
  const owners = new Set(ownerNodeIds);
  const definitions = Object.values(document.regionDefinitions || {})
    .filter((definition) => owners.has(definition.context.ownerNodeId))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    definitions,
    definitionIdMap: Object.fromEntries(
      definitions.map((definition) => [definition.id, allocate()]),
    ),
  };
}

/** Re-key copied Path basis catalogs before remapping selectors. Path IDs are
 * implicit bases; catalog-only bridge bases receive fresh IDs. */
export function remapCopiedPathBases(
  sourceDocument,
  copiedDocument,
  sketchIds,
  idMap,
  allocate,
) {
  const pathIdMap = {};
  for (const sourceSketchId of sketchIds)
    for (const pathId of Object.keys(
      sourceDocument.sketches[sourceSketchId].paths,
    ))
      pathIdMap[pathId] = idMap[pathId];
  const basisIdMap = {};
  const basis = (id) => {
    if (pathIdMap[id]) return pathIdMap[id];
    if (!basisIdMap[id]) basisIdMap[id] = allocate();
    return basisIdMap[id];
  };
  for (const sourceSketchId of sketchIds) {
    const sourceSketch = sourceDocument.sketches[sourceSketchId];
    const copiedSketch = copiedDocument.sketches[idMap[sourceSketchId]];
    for (const sourcePath of Object.values(sourceSketch.paths)) {
      const copiedPath = copiedSketch.paths[idMap[sourcePath.id]];
      const catalog = sourcePath.basisCatalog || {};
      const explicitBases = sourcePath.edges
        .map((use) => use.basisId)
        .filter((id) => typeof id === 'string');
      const pieceBases = sourcePath.edges.flatMap((use) =>
        (use.basisPieces || [])
          .map((piece) => piece.basisId)
          .filter((id) => typeof id === 'string'),
      );
      const sourceBases = [
        ...new Set([...Object.keys(catalog), ...explicitBases, ...pieceBases]),
      ];
      copiedPath.edges = copiedPath.edges.map((use, index) => {
        const sourceUse = sourcePath.edges[index];
        return {
          ...use,
          ...(sourceUse.basisId === undefined
            ? {}
            : { basisId: basis(sourceUse.basisId) }),
          ...(Array.isArray(sourceUse.basisPieces)
            ? {
                basisPieces: sourceUse.basisPieces.map((piece) => ({
                  ...clone(piece),
                  basisId: basis(piece.basisId),
                })),
              }
            : {}),
        };
      });
      if (sourcePath.basisCatalog !== undefined)
        copiedPath.basisCatalog = Object.fromEntries(
          sourceBases.map((basisId) => [
            basis(basisId),
            clone(catalog[basisId] || {}),
          ]),
        );
    }
  }
  return { pathIdMap, basisIdMap };
}

export function copyV5RegionDefinitions(
  targetDocument,
  definitions,
  { idMap = {}, definitionIdMap = {}, pathIdMap = {}, basisIdMap = {} } = {},
) {
  if (!definitions.length) return;
  targetDocument.regionDefinitions ||= {};
  for (const definition of definitions) {
    const id = definitionIdMap[definition.id];
    if (!id || targetDocument.regionDefinitions[id])
      throw Error('复制 V5 RegionDefinition ID 无效或重复');
    targetDocument.regionDefinitions[id] = {
      id,
      context: {
        ...clone(definition.context),
        ownerNodeId: mapId(definition.context.ownerNodeId, idMap),
        operatorId: mapId(definition.context.operatorId, idMap),
        instances: remapInstances(definition.context.instances, idMap),
      },
      selector: remapV5RegionSelector(definition.selector, {
        idMap,
        definitionIdMap,
        pathIdMap,
        basisIdMap,
      }),
    };
  }
}

const selectorUsesMovedBasis = (selector, sourceSketchId, movedBasisIds) => {
  if (selector?.kind !== 'cell') return false;
  const rings = [selector.outer, ...(selector.holes || [])];
  return rings.some((ring) =>
    ring.some((run) =>
      run.sources.some((source) => {
        const use = source.use;
        return (
          use?.sketchId === sourceSketchId &&
          (movedBasisIds.has(use.pathId) || movedBasisIds.has(use.basisId))
        );
      }),
    ),
  );
};

/** A source transfer preserves Path/basis IDs but changes their Sketch frame.
 * It only rewrites typed provenance uses that name one of the moved bases;
 * definition contexts and operator IDs deliberately remain unchanged. */
export function remapV5RegionDefinitionsForSketchTransfer(
  document,
  { sourceSketchId, targetSketchId, movedBasisIds },
) {
  if (document.version !== 5) return [];
  const changed = [];
  for (const definition of Object.values(document.regionDefinitions || {})) {
    if (
      !selectorUsesMovedBasis(
        definition.selector,
        sourceSketchId,
        movedBasisIds,
      )
    )
      continue;
    const rewriteRing = (ring) =>
      ring.map((run) => ({
        ...clone(run),
        sources: run.sources.map((source) => {
          const use = source.use;
          const moved =
            use.sketchId === sourceSketchId &&
            (movedBasisIds.has(use.pathId) || movedBasisIds.has(use.basisId));
          return moved
            ? {
                ...clone(source),
                use: { ...clone(use), sketchId: targetSketchId },
              }
            : clone(source);
        }),
      }));
    definition.selector = {
      ...clone(definition.selector),
      outer: rewriteRing(definition.selector.outer),
      holes: (definition.selector.holes || []).map(rewriteRing),
    };
    changed.push(definition.id);
  }
  return changed;
}
