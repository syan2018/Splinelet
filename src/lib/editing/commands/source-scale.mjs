import { validateDocument } from '../../document/schema.mjs';

const clone = (value) => structuredClone(value);
const scaleScalar = (value, factor) => {
  if (typeof value === 'number') return value * factor;
  if (factor === 1) return clone(value);
  // Repeated calibration should not accumulate an unbounded chain of wrappers.
  if (
    value.kind === 'expression' &&
    value.op === 'multiply' &&
    value.args.length === 2 &&
    typeof value.args[0] === 'number'
  )
    return scaleScalar(value.args[1], value.args[0] * factor);
  return { kind: 'expression', op: 'multiply', args: [factor, clone(value)] };
};

/** Recalibrate authored source space around the world origin. Construction
 * parameters/frames and manufacturing dimensions remain physical millimetres.
 * This is an explicit document-wide calibration, including locked objects;
 * visibility and locking are preserved rather than creating mixed scales. */
export function createSourceScaleCommand(request) {
  const action = clone(request);
  return (document) => {
    if (
      action.kind !== 'calibrate-source-scale' ||
      Object.keys(action).some((key) => !['kind', 'factor'].includes(key)) ||
      !Number.isFinite(action.factor) ||
      action.factor <= 0
    )
      throw Error('源比例必须是正有限数');
    validateDocument(document);
    const factor = action.factor;
    if (factor === 1) return { document, changedRefs: [] };
    const next = clone(document),
      changedRefs = [];
    if (next.sourceFrame) next.sourceFrame.widthMM *= factor;
    const vector = (value) => value.map((n) => n * factor);
    const scalarVector = (value) => value.map((n) => scaleScalar(n, factor));
    for (const node of Object.values(next.nodes)) {
      node.pose.translationMM = vector(node.pose.translationMM);
      changedRefs.push({ kind: 'node', id: node.id });
    }
    for (const sketch of Object.values(next.sketches)) {
      for (const vertex of Object.values(sketch.vertices))
        if (vertex.position.kind === 'free')
          vertex.position.value = vector(vertex.position.value);
      for (const edge of Object.values(sketch.edges))
        for (const name of ['startHandle', 'endHandle'])
          if (edge[name].kind === 'free')
            edge[name].vector = vector(edge[name].vector);
      changedRefs.push({ kind: 'sketch', id: sketch.id });
    }
    for (const datum of Object.values(next.datums)) {
      const field = datum.kind === 'point' ? 'position' : 'origin';
      datum[field] = scalarVector(datum[field]);
      changedRefs.push({ kind: 'datum', id: datum.id });
    }
    for (const relation of Object.values(next.relations)) {
      if (relation.kind === 'handle-continuity') {
        if (relation.mode === 'smooth')
          relation.length = scaleScalar(relation.length, factor);
      } else {
        if (relation.kind === 'point-on-axis')
          relation.distance = scaleScalar(relation.distance, factor);
        else relation.offset = scalarVector(relation.offset);
        // S * frame * inverse(S) keeps angles and scales translation. Scaling
        // both owners and sources then preserves the same geometric relation.
        relation.frame.transform[4] *= factor;
        relation.frame.transform[5] *= factor;
      }
      changedRefs.push({ kind: 'relation', id: relation.id });
    }
    for (const reference of Object.values(next.references)) {
      // Pixels are not source millimetres: left-multiply the entire affine by S.
      reference.pixelToWorld = vector(reference.pixelToWorld);
      changedRefs.push({ kind: 'reference', id: reference.id });
    }
    validateDocument(next);
    return { document: next, changedRefs };
  };
}
