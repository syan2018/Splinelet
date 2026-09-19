import assert from 'node:assert/strict';
import {
  createDocument,
  inspectDocumentReferences,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';

let sequence = 0;
const fresh = () => `id-${++sequence}`;
const document = createDocument({ idFactory: fresh });
assert.equal(document.version, 4);
assert.equal(document.units, 'mm');
assert.equal(document.manufacturing.layerHeightMM, 0.2);
assert.equal(Object.keys(document.manufacturing.parts).length, 1);
assert.equal(validateDocument(document), document);

const complete = structuredClone(document);
const partId = complete.manufacturing.defaultPartId;
complete.nodes.shape = {
  id: 'shape',
  name: '杯身',
  kind: 'shape',
  parentId: null,
  order: 0,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId: 'program',
};
complete.programs.program = {
  id: 'program',
  ownerNodeId: 'shape',
  operators: {},
  outputs: {},
};
complete.sketches.sketch = {
  id: 'sketch',
  ownerNodeId: 'shape',
  vertices: {
    vertex: { id: 'vertex', position: { kind: 'free', value: [0, 0] } },
  },
  edges: {},
  paths: {},
};
complete.parameters.parameter = {
  id: 'parameter',
  name: '数量',
  ownerNodeId: null,
  unit: 'count',
  value: 8,
};
complete.datums.axis = {
  id: 'axis',
  name: '中心轴',
  ownerNodeId: null,
  kind: 'axis',
  origin: [0, 0],
  angleRad: 0,
};
complete.relations.relation = {
  id: 'relation',
  kind: 'point-on-axis',
  target: { kind: 'vertex', sketchId: 'sketch', id: 'vertex' },
  axisId: 'axis',
  distance: 2,
  frame: { space: 'owner-local', transform: [1, 0, 0, 1, 0, 0] },
};
complete.sketches.sketch.vertices.vertex.position = {
  kind: 'relation',
  relationId: 'relation',
};
complete.appearances.swatches.red = { id: 'red', name: '红', color: '#ff0000' };
complete.appearances.defaults.shape = { swatchId: 'red' };
complete.reliefDefinitions.defaults.shape = {
  enabled: false,
  thickness: { kind: 'mm', value: 1 },
  mode: 'add',
  placement: { kind: 'free', zMM: 0 },
};
complete.manufacturing.assignments.assignment = {
  id: 'assignment',
  target: { kind: 'node', id: 'shape' },
  partId,
};
validateDocument(complete);
assert.deepEqual(inspectDocumentReferences(complete), []);

const unresolved = structuredClone(complete);
unresolved.sketches.sketch.edges.edge = {
  id: 'edge',
  startVertexId: 'missing-start',
  endVertexId: 'missing-end',
  startHandle: { kind: 'free', vector: [0, 0] },
  endHandle: { kind: 'free', vector: [0, 0] },
};
validateDocument(unresolved);
assert.ok(
  inspectDocumentReferences(unresolved).some((item) =>
    /Edge 顶点不存在/.test(item.message),
  ),
);

const duplicate = structuredClone(complete);
duplicate.nodes.group = {
  id: 'shape',
  name: '重复',
  kind: 'group',
  parentId: null,
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
};
assert.throws(() => validateDocument(duplicate), /重复 ID|表键与记录 ID/);

const badOwner = structuredClone(complete);
badOwner.nodes.group = {
  id: 'group',
  name: '组',
  kind: 'group',
  parentId: null,
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
};
badOwner.sketches.sketch.ownerNodeId = 'group';
assert.throws(
  () => validateDocument(badOwner),
  /Sketch.ownerNodeId 必须是.*Shape/,
);

const missingParent = structuredClone(complete);
missingParent.nodes.shape.parentId = 'removed-group';
assert.throws(() => validateDocument(missingParent), /Node.parentId 必须存在/);

const parentCycle = structuredClone(complete);
parentCycle.nodes.group = {
  id: 'group',
  name: '组',
  kind: 'group',
  parentId: 'group',
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
};
assert.throws(() => validateDocument(parentCycle), /Node.parentId 不能形成环/);

const missingProgram = structuredClone(complete);
delete missingProgram.programs.program;
assert.throws(
  () => validateDocument(missingProgram),
  /Shape.programId 必须存在/,
);

const groupManufacturingTarget = structuredClone(complete);
groupManufacturingTarget.nodes.group = {
  id: 'group',
  name: '组',
  kind: 'group',
  parentId: null,
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
};
groupManufacturingTarget.manufacturing.assignments.assignment.target = {
  kind: 'node',
  id: 'group',
};
assert.throws(
  () => validateDocument(groupManufacturingTarget),
  /只能引用 Shape/,
);

const foreignPublishedPort = structuredClone(complete);
foreignPublishedPort.nodes.other = {
  id: 'other',
  name: '另一部件',
  kind: 'shape',
  parentId: null,
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId: 'other-program',
};
foreignPublishedPort.programs['other-program'] = {
  id: 'other-program',
  ownerNodeId: 'other',
  operators: {},
  outputs: {},
};
foreignPublishedPort.programs.program.outputs.curves = {
  kind: 'port',
  ownerNodeId: 'other',
  operatorId: 'missing',
  port: 'curves',
  domain: 'curves',
};
assert.throws(
  () => validateDocument(foreignPublishedPort),
  /Program.outputs 必须发布自身 owner/,
);

const groupDefault = structuredClone(complete);
groupDefault.nodes.group = {
  id: 'group',
  name: '组',
  kind: 'group',
  parentId: null,
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
};
groupDefault.appearances.defaults.group = { swatchId: 'red' };
assert.throws(
  () => validateDocument(groupDefault),
  /appearances.defaults 键只能是 Shape/,
);

const wrongAxisKind = structuredClone(complete);
wrongAxisKind.datums.axis = {
  id: 'axis',
  name: '点',
  ownerNodeId: null,
  kind: 'point',
  position: [0, 0],
};
assert.throws(() => validateDocument(wrongAxisKind), /必须引用 axis Datum/);

const duplicateRelationTarget = structuredClone(complete);
duplicateRelationTarget.relations.other = {
  id: 'other',
  kind: 'point-on-axis',
  target: { id: 'vertex', kind: 'vertex', sketchId: 'sketch' },
  axisId: 'axis',
  distance: 3,
  frame: { space: 'owner-local', transform: [1, 0, 0, 1, 0, 0] },
};
assert.throws(
  () => validateDocument(duplicateRelationTarget),
  /Relation.target|同一目标/,
);

const cyclicJson = structuredClone(complete);
cyclicJson.appearances.swatches.red.loop = cyclicJson.appearances.swatches.red;
assert.throws(() => validateDocument(cyclicJson), /不能包含循环/);

const crossOwnerInput = structuredClone(complete);
crossOwnerInput.nodes.other = {
  id: 'other',
  name: '另一部件',
  kind: 'shape',
  parentId: null,
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId: 'other-program',
};
crossOwnerInput.programs['other-program'] = {
  id: 'other-program',
  ownerNodeId: 'other',
  operators: {
    source: {
      id: 'source',
      type: 'source',
      name: '源',
      enabled: true,
      inputs: { input: [{ kind: 'sketch', sketchId: 'sketch' }] },
      params: {},
    },
  },
  outputs: {},
};
assert.throws(() => validateDocument(crossOwnerInput), /Sketch InputRef/);

const badRuntime = structuredClone(complete);
badRuntime.preview = {};
assert.throws(() => validateDocument(badRuntime), /未声明字段 preview/);

console.log(
  'PASS: V4 document factory, strict structure, owners, unresolved references, and default resources.',
);
