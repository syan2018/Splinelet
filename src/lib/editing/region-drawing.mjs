/** Derive region uses from actual branch inputs, never a parallel role table. */
export function regionPathUses(document, pathRef) {
  return regionPathMemberships(document, pathRef)
    .filter((use) => use.included)
    .map(({ ownerNodeId, operatorId, role, drawing }) => ({
      ownerNodeId,
      operatorId,
      role,
      drawing,
    }));
}

/** Includes suspended membership so restoring a boundary keeps its original
 * Fill (and even-odd holes), rather than appending an unrelated filled region. */
export function regionPathMemberships(document, pathRef) {
  const sketch = document.sketches[pathRef?.sketchId];
  if (pathRef?.kind !== 'path' || !sketch?.paths[pathRef.id]) return [];
  const ownerNodeId = sketch.ownerNodeId;
  const program = document.programs[document.nodes[ownerNodeId]?.programId];
  const operators = Object.values(program?.operators || {});
  // A published Fill (or a Fill feeding ordinary region construction) supplies
  // boundaries. A private Fill used only as a Difference operand supplies holes.
  const boundaryConsumers = new Set();
  const include = (input) => {
    if (input?.kind === 'port' && input.ownerNodeId === ownerNodeId)
      boundaryConsumers.add(input.operatorId);
  };
  include(program?.outputs.regions);
  for (const consumer of operators)
    for (const [port, inputs] of Object.entries(consumer.inputs)) {
      if (
        consumer.type === 'boolean' &&
        consumer.params.operation === 'difference' &&
        port === 'operand'
      )
        continue;
      inputs.forEach(include);
    }
  const boundaryFill = (operator) =>
    operator.authoring?.phase === 'drawing' ||
    boundaryConsumers.has(operator.id);
  const matches = [];
  for (const operator of operators) {
    let sourceInput;
    let inputOperatorId = operator.id;
    let inputPort = 'input';
    if (
      operator.type === 'fill' &&
      boundaryFill(operator) &&
      operator.inputs.input?.length === 1
    )
      sourceInput = operator.inputs.input[0];
    else if (
      operator.type === 'partition' &&
      operator.inputs.cutter?.length === 1
    ) {
      sourceInput = operator.inputs.cutter[0];
      inputPort = 'cutter';
    } else if (
      operator.type === 'boolean' &&
      operator.params.operation === 'difference' &&
      operator.inputs.operand?.length === 1
    ) {
      const fillRef = operator.inputs.operand[0];
      const fill =
        fillRef.ownerNodeId === ownerNodeId &&
        program.operators[fillRef.operatorId];
      if (fill?.type === 'fill' && fill.inputs.input?.length === 1) {
        sourceInput = fill.inputs.input[0];
        inputOperatorId = fill.id;
      }
    }
    let source =
      sourceInput?.ownerNodeId === ownerNodeId &&
      program.operators[sourceInput.operatorId];
    let filter;
    if (source?.type === 'curve-filter' && source.inputs.input?.length === 1) {
      filter = source;
      const ref = filter.inputs.input[0];
      source =
        ref.ownerNodeId === ownerNodeId && program.operators[ref.operatorId];
      if (!Array.isArray(filter.params?.excludedPaths)) continue;
    }
    const paths = source?.type === 'source' ? source.inputs.paths : [];
    // Incremental drawing remains an exclusive single-path branch. Broader
    // committed membership must not make another path resumable as this branch.
    if (
      operator.authoring?.phase === 'drawing' &&
      (filter || paths.length !== 1 || paths[0].pathIds?.length !== 1)
    )
      continue;
    if (
      !paths?.some(
        (input) =>
          input.kind === 'sketch' &&
          input.sketchId === sketch.id &&
          (input.pathIds === undefined || input.pathIds.includes(pathRef.id)),
      )
    )
      continue;
    matches.push({
      ownerNodeId,
      operatorId: operator.id,
      role:
        operator.type === 'fill'
          ? 'boundary'
          : operator.type === 'partition'
            ? 'divider'
            : 'hole',
      drawing: operator.authoring?.phase === 'drawing',
      inputOperatorId,
      inputPort,
      sourceId: source.id,
      filterId: filter?.id,
      included:
        !filter?.enabled ||
        !filter.params.excludedPaths.some(
          (ref) => ref?.sketchId === pathRef.sketchId && ref.id === pathRef.id,
        ),
    });
  }
  return matches;
}

export function findRegionDrawing(document, pathRef) {
  const matches = regionPathUses(document, pathRef).filter(
    (use) => use.drawing,
  );
  if (matches.length > 1) throw Error('线条存在多个未完成的区域用途，请先修复');
  if (!matches.length) return null;
  const { ownerNodeId, operatorId, role } = matches[0];
  return { ownerNodeId, operatorId, role };
}
