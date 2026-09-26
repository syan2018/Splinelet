import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import {
  createSourceOrganizationCommand,
  SOURCE_ORGANIZATION_ACTIONS,
} from '../../../src/lib/editing/commands/source-organization.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';

const pathRef = (sketchId, id) => ({ kind: 'path', sketchId, id });

function fixture() {
  const document = createDocument({
    version: 4,
    id: 'source-organization-document',
    idFactory: () => 'source-organization-part',
  });
  for (const { suffix, order } of [
    { suffix: 'a', order: 7 },
    { suffix: 'b', order: 3 },
  ]) {
    const nodeId = `shape-${suffix}`;
    const programId = `program-${suffix}`;
    const sketchId = `sketch-${suffix}`;
    const operatorId = `source-${suffix}`;
    document.nodes[nodeId] = {
      id: nodeId,
      kind: 'shape',
      name: nodeId,
      parentId: null,
      order,
      pose: { translationMM: [order, -order], rotationRad: order / 10 },
      visible: true,
      locked: false,
      programId,
    };
    const ids = suffix === 'a' ? ['path-a1', 'path-a2'] : ['path-b1'];
    document.sketches[sketchId] = {
      id: sketchId,
      ownerNodeId: nodeId,
      vertices: Object.fromEntries(
        ids.map((id, index) => [
          `vertex-${id}`,
          {
            id: `vertex-${id}`,
            position: { kind: 'free', value: [index + order, index] },
          },
        ]),
      ),
      edges: {},
      paths: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            id,
            name: id,
            edges: [],
            startVertexId: `vertex-${id}`,
            visible: true,
          },
        ]),
      ),
    };
    document.programs[programId] = {
      id: programId,
      ownerNodeId: nodeId,
      operators: {
        [operatorId]: {
          id: operatorId,
          type: 'source',
          name: operatorId,
          enabled: true,
          inputs: {
            paths: [{ kind: 'sketch', sketchId, pathIds: ids }],
          },
          params: {},
        },
      },
      outputs: {
        curves: {
          kind: 'port',
          ownerNodeId: nodeId,
          operatorId,
          port: 'curves',
          domain: 'curves',
        },
      },
    };
  }
  document.collections.mixed = {
    id: 'mixed',
    name: '通用集合',
    members: [{ kind: 'node', id: 'shape-a' }, pathRef('sketch-a', 'path-a1')],
    origin: 'user',
  };
  return document;
}

const editorFor = (document) => {
  let sequence = 0;
  return createEditorSession(document, {
    idFactory: () => `organization-${++sequence}`,
  });
};
const dispatch = (editor, action) =>
  editor.dispatch(createSourceOrganizationCommand(action), {
    expectedRevision: editor.state.revision,
  });
const sourceState = (document) => ({
  nodes: document.nodes,
  programs: document.programs,
  sketches: Object.fromEntries(
    Object.entries(document.sketches).map(([id, sketch]) => [
      id,
      {
        ownerNodeId: sketch.ownerNodeId,
        vertices: sketch.vertices,
        edges: sketch.edges,
        paths: Object.fromEntries(
          Object.entries(sketch.paths).map(([pathId, path]) => [
            pathId,
            Object.fromEntries(
              Object.entries(path).filter(([key]) => key !== 'order'),
            ),
          ]),
        ),
      },
    ]),
  ),
});

assert.deepEqual(SOURCE_ORGANIZATION_ACTIONS, [
  'create-path-collection',
  'assign-path-collection',
  'rename-collection',
  'delete-collection',
  'reorder-source-paths',
]);

const collectionFixture = () => {
  const document = fixture();
  document.collections.alpha = {
    id: 'alpha',
    name: '甲路径集合',
    members: [pathRef('sketch-a', 'path-a1'), pathRef('sketch-a', 'path-a2')],
    origin: 'user',
    order: 3,
  };
  document.collections.beta = {
    id: 'beta',
    name: '乙路径集合',
    members: [pathRef('sketch-b', 'path-b1'), pathRef('sketch-a', 'path-a1')],
    origin: 'user',
    order: 4,
  };
  document.collections.gamma = {
    id: 'gamma',
    name: '目标路径集合',
    members: [pathRef('sketch-a', 'path-a2'), pathRef('sketch-a', 'path-a1')],
    origin: 'user',
    order: 5,
  };
  return document;
};

const assignmentDocument = collectionFixture();
const assignmentBefore = structuredClone(assignmentDocument);
const assignmentSource = sourceState(assignmentDocument);
const assignmentEditor = editorFor(assignmentDocument);
dispatch(assignmentEditor, {
  kind: 'assign-path-collection',
  collectionId: 'gamma',
  pathRefs: [pathRef('sketch-a', 'path-a1'), pathRef('sketch-b', 'path-b1')],
});
assert.deepEqual(assignmentEditor.state.document.collections.alpha.members, [
  pathRef('sketch-a', 'path-a2'),
]);
assert.deepEqual(assignmentEditor.state.document.collections.beta.members, []);
assert.deepEqual(assignmentEditor.state.document.collections.gamma.members, [
  pathRef('sketch-a', 'path-a2'),
  pathRef('sketch-a', 'path-a1'),
  pathRef('sketch-b', 'path-b1'),
]);
assert.deepEqual(
  assignmentEditor.state.document.collections.mixed,
  assignmentBefore.collections.mixed,
  'mixed collections keep overlapping Path members',
);
assert.deepEqual(
  sourceState(assignmentEditor.state.document),
  assignmentSource,
);
assert.deepEqual(
  assignmentEditor.state.document.collections.gamma.order,
  assignmentBefore.collections.gamma.order,
);
assignmentEditor.undo({ expectedRevision: assignmentEditor.state.revision });
assert.deepEqual(assignmentEditor.state.document, assignmentBefore);
assignmentEditor.redo({ expectedRevision: assignmentEditor.state.revision });

dispatch(assignmentEditor, {
  kind: 'assign-path-collection',
  collectionId: null,
  pathRefs: [pathRef('sketch-a', 'path-a2'), pathRef('sketch-b', 'path-b1')],
});
assert.deepEqual(assignmentEditor.state.document.collections.alpha.members, []);
assert.deepEqual(assignmentEditor.state.document.collections.beta.members, []);
assert.deepEqual(assignmentEditor.state.document.collections.gamma.members, [
  pathRef('sketch-a', 'path-a1'),
]);
assert.deepEqual(
  assignmentEditor.state.document.collections.mixed,
  assignmentBefore.collections.mixed,
);

for (const action of [
  {
    kind: 'assign-path-collection',
    collectionId: 'mixed',
    pathRefs: [pathRef('sketch-a', 'path-a1')],
  },
  {
    kind: 'assign-path-collection',
    collectionId: 'alpha',
    pathRefs: [pathRef('sketch-a', 'path-a1'), pathRef('sketch-a', 'path-a1')],
  },
  {
    kind: 'assign-path-collection',
    collectionId: 'alpha',
    pathRefs: [pathRef('sketch-a', 'missing')],
  },
]) {
  const editor = editorFor(collectionFixture());
  const before = editor.state.document;
  assert.throws(() => dispatch(editor, action), /只包含 Path|不能重复|不存在/);
  assert.deepEqual(editor.state.document, before);
}

const lockedAssignment = collectionFixture();
lockedAssignment.nodes['shape-b'].locked = true;
const lockedAssignmentEditor = editorFor(lockedAssignment);
const lockedAssignmentBefore = lockedAssignmentEditor.state.document;
assert.throws(
  () =>
    dispatch(lockedAssignmentEditor, {
      kind: 'assign-path-collection',
      collectionId: null,
      pathRefs: [pathRef('sketch-b', 'path-b1')],
    }),
  /锁定/,
);
assert.deepEqual(lockedAssignmentEditor.state.document, lockedAssignmentBefore);

const createDocumentFixture = fixture();
const createBefore = structuredClone(createDocumentFixture);
const createEditor = editorFor(createDocumentFixture);
dispatch(createEditor, {
  kind: 'create-path-collection',
  name: '  跨来源分组  ',
  pathRefs: [pathRef('sketch-a', 'path-a2'), pathRef('sketch-b', 'path-b1')],
});
const created = createEditor.state.document.collections['organization-2'];
assert.deepEqual(created, {
  id: 'organization-2',
  name: '跨来源分组',
  members: [pathRef('sketch-a', 'path-a2'), pathRef('sketch-b', 'path-b1')],
  origin: 'user',
  order: 1,
});
assert.deepEqual(
  createEditor.state.document.collections.mixed,
  createBefore.collections.mixed,
  'creating a Path collection does not steal members from generic collections',
);
assert.deepEqual(
  sourceState(createEditor.state.document),
  sourceState(createBefore),
);
createEditor.undo({ expectedRevision: createEditor.state.revision });
assert.deepEqual(createEditor.state.document, createBefore);

const emptyDocument = fixture();
const emptyEditor = editorFor(emptyDocument);
dispatch(emptyEditor, {
  kind: 'create-path-collection',
  name: '空集合',
  pathRefs: [],
});
assert.deepEqual(
  emptyEditor.state.document.collections['organization-2'].members,
  [],
);

const renameDocument = fixture();
const renameEditor = editorFor(renameDocument);
dispatch(renameEditor, {
  kind: 'rename-collection',
  collectionId: 'mixed',
  name: '  新名称  ',
});
assert.equal(renameEditor.state.document.collections.mixed.name, '新名称');
renameEditor.undo({ expectedRevision: renameEditor.state.revision });
assert.deepEqual(renameEditor.state.document, renameDocument);

const deleteDocument = fixture();
const deleteSource = sourceState(deleteDocument);
const deleteEditor = editorFor(deleteDocument);
dispatch(deleteEditor, {
  kind: 'delete-collection',
  collectionId: 'mixed',
});
assert.equal(deleteEditor.state.document.collections.mixed, undefined);
assert.deepEqual(sourceState(deleteEditor.state.document), deleteSource);
deleteEditor.undo({ expectedRevision: deleteEditor.state.revision });
assert.deepEqual(deleteEditor.state.document, deleteDocument);

const reorderDocument = fixture();
const reorderSource = sourceState(reorderDocument);
const reorderPrograms = structuredClone(reorderDocument.programs);
const reorderNodes = structuredClone(reorderDocument.nodes);
const reorderCollections = structuredClone(reorderDocument.collections);
const reorderEditor = editorFor(reorderDocument);
const requestedOrder = [
  pathRef('sketch-b', 'path-b1'),
  pathRef('sketch-a', 'path-a2'),
  pathRef('sketch-a', 'path-a1'),
];
dispatch(reorderEditor, {
  kind: 'reorder-source-paths',
  pathRefs: requestedOrder,
});
requestedOrder.forEach((item, order) =>
  assert.equal(
    reorderEditor.state.document.sketches[item.sketchId].paths[item.id].order,
    order,
  ),
);
assert.deepEqual(sourceState(reorderEditor.state.document), reorderSource);
assert.deepEqual(reorderEditor.state.document.nodes, reorderNodes);
assert.deepEqual(reorderEditor.state.document.programs, reorderPrograms);
assert.deepEqual(reorderEditor.state.document.collections, reorderCollections);
reorderEditor.undo({ expectedRevision: reorderEditor.state.revision });
assert.deepEqual(reorderEditor.state.document, reorderDocument);

for (const invalid of [
  requestedOrder.slice(0, 2),
  [requestedOrder[0], requestedOrder[0], requestedOrder[2]],
  [...requestedOrder.slice(0, 2), pathRef('sketch-a', 'missing')],
]) {
  const editor = editorFor(fixture());
  const before = editor.state.document;
  assert.throws(
    () =>
      dispatch(editor, {
        kind: 'reorder-source-paths',
        pathRefs: invalid,
      }),
    /完整列出|不能重复|不存在/,
  );
  assert.deepEqual(editor.state.document, before);
}

const lockedCreate = fixture();
lockedCreate.nodes['shape-b'].locked = true;
const lockedCreateEditor = editorFor(lockedCreate);
assert.throws(
  () =>
    dispatch(lockedCreateEditor, {
      kind: 'create-path-collection',
      name: '不可创建',
      pathRefs: [pathRef('sketch-b', 'path-b1')],
    }),
  /锁定/,
);
assert.throws(
  () =>
    dispatch(lockedCreateEditor, {
      kind: 'reorder-source-paths',
      pathRefs: requestedOrder,
    }),
  /锁定/,
);

const lockedDelete = fixture();
lockedDelete.nodes['shape-a'].locked = true;
const lockedDeleteEditor = editorFor(lockedDelete);
const lockedDeleteBefore = lockedDeleteEditor.state.document;
assert.throws(
  () =>
    dispatch(lockedDeleteEditor, {
      kind: 'delete-collection',
      collectionId: 'mixed',
    }),
  /已锁定部件的成员/,
);
assert.deepEqual(lockedDeleteEditor.state.document, lockedDeleteBefore);

const invalidEditor = editorFor(fixture());
const invalidBefore = invalidEditor.state.document;
assert.throws(
  () =>
    dispatch(invalidEditor, {
      kind: 'create-path-collection',
      name: '   ',
      pathRefs: [],
    }),
  /名称/,
);
assert.throws(
  () =>
    dispatch(invalidEditor, {
      kind: 'rename-collection',
      collectionId: 'missing',
      name: '名称',
    }),
  /不存在/,
);
assert.throws(
  () =>
    dispatch(invalidEditor, {
      kind: 'rename-collection',
      collectionId: 'mixed',
      name: '名称',
      pathRefs: [],
    }),
  /请求字段无效/,
);
assert.deepEqual(invalidEditor.state.document, invalidBefore);

console.log(
  'PASS source organization creates independent Path collections, renames and dissolves metadata, globally reorders every Path, preserves source ownership and programs, rejects locked or incomplete edits, and undoes once',
);
