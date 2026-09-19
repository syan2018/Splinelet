import {
  inspectDocumentReferences,
  validateDocument,
} from '../document/schema.mjs';
import { childrenOf, descendantsOf, selectedRoots } from './hierarchy.mjs';

export function ownedEntities(document, nodeIds) {
  const roots = selectedRoots(document, nodeIds);
  const nodes = new Set(
    roots.flatMap((id) => [id, ...descendantsOf(document, id)]),
  );
  const sketches = new Set(
    Object.values(document.sketches)
      .filter((item) => nodes.has(item.ownerNodeId))
      .map((item) => item.id),
  );
  const programs = new Set(
    Object.values(document.programs)
      .filter((item) => nodes.has(item.ownerNodeId))
      .map((item) => item.id),
  );
  const datums = new Set(
    Object.values(document.datums)
      .filter((item) => nodes.has(item.ownerNodeId))
      .map((item) => item.id),
  );
  const parameters = new Set(
    Object.values(document.parameters)
      .filter((item) => nodes.has(item.ownerNodeId))
      .map((item) => item.id),
  );
  const relations = new Set(
    Object.values(document.relations)
      .filter((item) => sketches.has(item.target.sketchId))
      .map((item) => item.id),
  );
  return { roots, nodes, sketches, programs, datums, parameters, relations };
}

export function planNodeDeletion(document, nodeIds) {
  validateDocument(document);
  const owned = ownedEntities(document, nodeIds);
  const next = structuredClone(document);
  const removed = [];
  for (const table of [
    'nodes',
    'sketches',
    'programs',
    'datums',
    'parameters',
    'relations',
  ])
    for (const id of owned[table]) {
      removed.push({ table, id });
      delete next[table][id];
    }
  for (const id of owned.nodes) {
    delete next.appearances.defaults[id];
    delete next.reliefDefinitions.defaults[id];
  }
  // Soft incoming construction/assignment references remain explicit unresolved
  // definitions. Deletion never changes them into 'all outputs' or another node.
  validateDocument(next);
  const prior = new Set(
    inspectDocumentReferences(document).map((item) => JSON.stringify(item)),
  );
  const impacts = inspectDocumentReferences(next).filter(
    (item) => !prior.has(JSON.stringify(item)),
  );
  return { document: next, removed, impacts };
}

export function copyNodes(
  document,
  nodeIds,
  {
    idFactory = () => globalThis.crypto.randomUUID(),
    copyOperator,
    remapOutputReference,
  } = {},
) {
  validateDocument(document);
  const owned = ownedEntities(document, nodeIds);
  const next = structuredClone(document);
  const reserved = new Set();
  const scanIds = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string') reserved.add(value.id);
    for (const child of Object.values(value)) scanIds(child);
  };
  scanIds(document);
  const idMap = new Map();
  const allocate = (id) => {
    if (idMap.has(id)) return idMap.get(id);
    const result = idFactory();
    if (typeof result !== 'string' || !result.trim() || reserved.has(result))
      throw Error('复制 ID 无效或重复');
    reserved.add(result);
    idMap.set(id, result);
    return result;
  };
  for (const table of [
    'nodes',
    'sketches',
    'programs',
    'datums',
    'parameters',
    'relations',
  ])
    for (const id of owned[table]) allocate(id);
  for (const id of owned.sketches)
    for (const table of ['vertices', 'edges', 'paths'])
      for (const item of Object.values(document.sketches[id][table]))
        allocate(item.id);
  for (const id of owned.programs)
    for (const item of Object.values(document.programs[id].operators))
      allocate(item.id);
  const mapped = (id) => idMap.get(id) ?? id;
  const ref = (value) => {
    if (value.kind === 'output' && owned.nodes.has(value.ownerNodeId)) {
      if (typeof remapOutputReference !== 'function')
        throw Error('复制已绑定输出需要 provenance 重挂访问器');
      return structuredClone(
        remapOutputReference(structuredClone(value), Object.fromEntries(idMap)),
      );
    }
    const result = structuredClone(value);
    for (const key of ['id', 'ownerNodeId', 'operatorId', 'sketchId', 'edgeId'])
      if (key in result) result[key] = mapped(result[key]);
    if (result.pathIds) result.pathIds = result.pathIds.map(mapped);
    return result;
  };
  const scalar = (value) =>
    typeof value === 'number'
      ? value
      : value.kind === 'parameter'
        ? { ...value, id: mapped(value.id) }
        : { ...value, args: value.args.map(scalar) };
  const handle = (value) =>
    value.kind === 'relation'
      ? { ...value, relationId: mapped(value.relationId) }
      : structuredClone(value);
  for (const id of owned.nodes) {
    const node = structuredClone(document.nodes[id]);
    node.id = mapped(id);
    node.parentId = mapped(node.parentId);
    if (node.kind === 'shape') node.programId = mapped(node.programId);
    if (owned.roots.includes(id))
      node.order = childrenOf(next, node.parentId).reduce(
        (maximum, sibling) => Math.max(maximum, sibling.order + 1),
        0,
      );
    next.nodes[node.id] = node;
  }
  for (const id of owned.sketches) {
    const source = document.sketches[id];
    const sketch = {
      id: mapped(id),
      ownerNodeId: mapped(source.ownerNodeId),
      vertices: {},
      edges: {},
      paths: {},
    };
    for (const vertex of Object.values(source.vertices))
      sketch.vertices[mapped(vertex.id)] = {
        id: mapped(vertex.id),
        position: handle(vertex.position),
      };
    for (const edge of Object.values(source.edges))
      sketch.edges[mapped(edge.id)] = {
        ...structuredClone(edge),
        id: mapped(edge.id),
        startVertexId: mapped(edge.startVertexId),
        endVertexId: mapped(edge.endVertexId),
        startHandle: handle(edge.startHandle),
        endHandle: handle(edge.endHandle),
      };
    for (const path of Object.values(source.paths))
      sketch.paths[mapped(path.id)] = {
        ...structuredClone(path),
        id: mapped(path.id),
        edges: path.edges.map((use) => ({
          ...use,
          edgeId: mapped(use.edgeId),
        })),
        ...(path.handleModes
          ? {
              handleModes: Object.fromEntries(
                Object.entries(path.handleModes).map(([vertexId, mode]) => [
                  mapped(vertexId),
                  mode,
                ]),
              ),
            }
          : {}),
      };
    next.sketches[sketch.id] = sketch;
  }
  for (const table of ['datums', 'parameters'])
    for (const id of owned[table]) {
      const item = structuredClone(document[table][id]);
      item.id = mapped(id);
      item.ownerNodeId = mapped(item.ownerNodeId);
      if (table === 'datums') {
        if (item.kind === 'point') item.position = item.position.map(scalar);
        else {
          item.origin = item.origin.map(scalar);
          item.angleRad = scalar(item.angleRad);
        }
      }
      next[table][item.id] = item;
    }
  for (const id of owned.relations) {
    const relation = structuredClone(document.relations[id]);
    relation.id = mapped(id);
    relation.target = ref(relation.target);
    if (relation.source) relation.source = ref(relation.source);
    if (relation.axisId) relation.axisId = mapped(relation.axisId);
    if (relation.distance !== undefined)
      relation.distance = scalar(relation.distance);
    if (relation.length !== undefined)
      relation.length = scalar(relation.length);
    if (relation.offset) relation.offset = relation.offset.map(scalar);
    next.relations[relation.id] = relation;
  }
  for (const id of owned.programs) {
    const source = document.programs[id];
    const program = {
      id: mapped(id),
      ownerNodeId: mapped(source.ownerNodeId),
      operators: {},
      outputs: {},
    };
    for (const original of Object.values(source.operators)) {
      let operator = structuredClone(original);
      if (Object.keys(operator.params).length || operator.outputContract) {
        if (typeof copyOperator !== 'function')
          throw Error(`算子 ${original.id} 缺少复制引用访问器`);
        operator = structuredClone(
          copyOperator(operator, { idMap: Object.fromEntries(idMap) }),
        );
        if (!operator || operator.type !== original.type)
          throw Error('算子复制访问器返回无效定义');
      }
      operator.id = mapped(original.id);
      operator.inputs = Object.fromEntries(
        Object.entries(original.inputs).map(([port, inputs]) => [
          port,
          inputs.map(ref),
        ]),
      );
      program.operators[operator.id] = operator;
    }
    for (const [port, value] of Object.entries(source.outputs))
      program.outputs[port] = ref(value);
    next.programs[program.id] = program;
  }
  const relief = (value) => {
    const result = structuredClone(value);
    if (result.placement?.kind === 'attached')
      result.placement.target = ref(result.placement.target);
    return result;
  };
  for (const id of owned.nodes) {
    if (document.appearances.defaults[id])
      next.appearances.defaults[mapped(id)] = structuredClone(
        document.appearances.defaults[id],
      );
    if (document.reliefDefinitions.defaults[id])
      next.reliefDefinitions.defaults[mapped(id)] = relief(
        document.reliefDefinitions.defaults[id],
      );
  }
  for (const [table, transformValue] of [
    [next.appearances.overrides, structuredClone],
    [next.reliefDefinitions.overrides, relief],
    [next.manufacturing.assignments, structuredClone],
  ]) {
    for (const assignment of Object.values(table)) {
      const targetOwner =
        assignment.target.kind === 'node'
          ? assignment.target.id
          : assignment.target.ownerNodeId;
      if (!owned.nodes.has(targetOwner)) continue;
      const id = allocate(assignment.id);
      table[id] = {
        ...structuredClone(assignment),
        id,
        target: ref(assignment.target),
        ...(assignment.value
          ? { value: transformValue(assignment.value) }
          : {}),
      };
    }
  }
  for (const target of document.manufacturing.excluded)
    if (
      owned.nodes.has(target.kind === 'node' ? target.id : target.ownerNodeId)
    )
      next.manufacturing.excluded.push(ref(target));
  validateDocument(next);
  return {
    document: next,
    idMap: Object.fromEntries(idMap),
    roots: owned.roots.map(mapped),
  };
}
