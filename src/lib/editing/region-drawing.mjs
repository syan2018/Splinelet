/** Derive region uses from actual branch inputs, never a parallel role table. */
export function regionPathUses(document, pathRef) {
  const sketch = document.sketches[pathRef?.sketchId];
  if (pathRef?.kind !== 'path' || !sketch?.paths[pathRef.id]) return [];
  const ownerNodeId = sketch.ownerNodeId;
  const program = document.programs[document.nodes[ownerNodeId]?.programId];
  const matches = [];
  for (const operator of Object.values(program?.operators || {})) {
    let sourceInput;
    if (operator.type === 'partition' && operator.inputs.cutter?.length === 1)
      sourceInput = operator.inputs.cutter[0];
    else if (
      operator.type === 'boolean' &&
      operator.params.operation === 'difference' &&
      operator.inputs.operand?.length === 1
    ) {
      const fillRef = operator.inputs.operand[0];
      const fill =
        fillRef.ownerNodeId === ownerNodeId &&
        program.operators[fillRef.operatorId];
      if (fill?.type === 'fill' && fill.inputs.input?.length === 1)
        sourceInput = fill.inputs.input[0];
    }
    const source =
      sourceInput?.ownerNodeId === ownerNodeId &&
      program.operators[sourceInput.operatorId];
    const paths = source?.type === 'source' && source.inputs.paths;
    if (
      paths?.length !== 1 ||
      paths[0].kind !== 'sketch' ||
      paths[0].sketchId !== sketch.id ||
      paths[0].pathIds?.length !== 1 ||
      paths[0].pathIds[0] !== pathRef.id
    )
      continue;
    matches.push({
      ownerNodeId,
      operatorId: operator.id,
      role: operator.type === 'partition' ? 'divider' : 'hole',
      drawing: operator.authoring?.phase === 'drawing',
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
