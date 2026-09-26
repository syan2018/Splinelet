import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { compileModifierAdd } from '../../../src/lib/editor/modifier-intents.mjs';
import { createPlanarStageCache } from '../../../src/lib/evaluation/planar-stage-cache.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { createRebindModifierInputCommand } from '../../../src/lib/editing/commands/rebind-modifier-input.mjs';

for (const version of [4, 5]) {
  let serial = 0;
  const idFactory = () => `repair-${version}-${++serial}`;
  const editor = createEditorSession(createDocument({ version, idFactory }), {
    idFactory,
  });
  const dispatch = (command) =>
    editor.dispatch(command, { expectedRevision: editor.state.revision });
  for (const x of [0, 20])
    dispatch(
      createAuthoringCommand({
        kind: 'draw-path',
        closed: true,
        points: [
          [x, 0],
          [x + 10, 0],
          [x + 10, 10],
          [x, 10],
        ],
      }),
    );
  const [owner, independent] = Object.values(editor.state.document.nodes);
  dispatch(
    createAuthoringCommand(
      compileModifierAdd(editor.state.document, {
        objectId: owner.id,
        type: 'curve_mirror',
        targets: { kind: 'all' },
        centerMM: { x: 0, y: 0 },
        angleDeg: 90,
      }),
    ),
  );
  const getProgram = () => editor.state.document.programs[owner.programId];
  const mirror = Object.values(getProgram().operators).find(
    (op) => op.type === 'curve-mirror',
  );
  const original = structuredClone(mirror.inputs.input[0]);
  const cache = createPlanarStageCache();
  const runtime = createV4CreationRuntime({
    editorSession: editor,
    toDisplayProject: (_state, view) => ({ creation: view.creation }),
    evaluate: (document, options) =>
      evaluateDocument(document, { ...options, planarStageCache: cache }),
  });
  let project = runtime.project();
  await runtime.evaluate('creation', {}, project);
  const baseline = runtime.readModifierSnapshot(project, mirror.id, 'curves');
  assert.equal(baseline.current.status, 'ready');
  const initialRevision = baseline.lastSuccessful.revision;
  const before = cache.evaluate(editor.state.document);
  // Normal parameter edits require no evaluated scene and preserve all bindings.
  project = runtime
    .command(
      'modifier_update',
      { objectId: owner.id, modifierId: mirror.id, changes: { angleDeg: 60 } },
      { project, scene: null },
    )
    .commit();
  assert(
    Math.abs(
      runtime
        .readModifierStatus(project)
        .find((op) => op.modifierId === mirror.id).controls.values.angleDeg -
        60,
    ) < 1e-10,
  );
  assert.deepEqual(getProgram().operators[mirror.id].inputs.input[0], original);
  const changed = cache.evaluate(editor.state.document);
  const independentOutput =
    editor.state.document.programs[independent.programId].outputs.regions
      .operatorId;
  assert.equal(
    changed.components[`operator:${independentOutput}`],
    before.components[`operator:${independentOutput}`],
    'unrelated branch is not reevaluated',
  );
  assert.notEqual(
    changed.components[`operator:${mirror.id}`],
    before.components[`operator:${mirror.id}`],
  );
  assert.equal(
    runtime.readModifierSnapshot(project, mirror.id, 'curves').lastSuccessful
      .revision,
    initialRevision,
  );
  await runtime.evaluate('creation', {}, project);
  const lastSuccessfulRevision = editor.state.revision;
  dispatch((document) => {
    document.programs[owner.programId].operators[
      mirror.id
    ].inputs.input[0].operatorId = 'removed-producer';
    return { document };
  });
  project = runtime.project();
  const brokenDocument = editor.state.document;
  const broken = await runtime.evaluate('creation', {}, project);
  assert.equal(
    broken.creation.objects.find((item) => item.id === independent.id)
      .evaluation.regions,
    'ready',
  );
  const snapshot = runtime.readModifierSnapshot(project, mirror.id, 'curves');
  assert.equal(snapshot.current.status, 'blocked');
  assert.equal(snapshot.lastSuccessful.revision, lastSuccessfulRevision);
  assert.equal(snapshot.freshness, 'stale');
  assert.equal(
    snapshot.current.value,
    undefined,
    'old result is not a current input',
  );
  const inputView = runtime.readModifierInputs(project, owner.id, mirror.id);
  assert(
    inputView.inputs[0].diagnostics.some(
      (item) => item.code === 'invalid-port-owner',
    ),
  );
  const request = {
    ownerNodeId: owner.id,
    operatorId: mirror.id,
    input: 'input',
    index: 0,
    reference: original,
  };
  let prepared = await runtime.prepareModifierInputRepair(request, { project });
  assert.equal(prepared.ports.curves.status, 'ready');
  assert.deepEqual(
    editor.state.document,
    brokenDocument,
    'candidate evaluation never mutates authority',
  );
  assert.equal(
    runtime.readModifierSnapshot(project, mirror.id, 'curves').current.status,
    'blocked',
    'candidate must not publish as current',
  );
  prepared.cancel();
  assert.throws(() => prepared.commit(), /结束/);
  assert.deepEqual(editor.state.document, brokenDocument);
  prepared = await runtime.prepareModifierInputRepair(request, { project });
  project = prepared.commit();
  assert.deepEqual(getProgram().operators[mirror.id].inputs.input[0], original);
  assert.throws(() => prepared.commit(), /结束/);
  await runtime.evaluate('creation', {}, project);
  assert.equal(
    runtime.readModifierSnapshot(project, mirror.id, 'curves').current.status,
    'ready',
  );
  editor.undo({ expectedRevision: editor.state.revision });
  assert.deepEqual(
    editor.state.document,
    brokenDocument,
    'one undo restores the exact broken author graph',
  );
  project = runtime.project();
  const stale = await runtime.prepareModifierInputRepair(request, { project });
  dispatch(
    createAuthoringCommand({
      kind: 'set-operator',
      ownerNodeId: owner.id,
      operatorId: mirror.id,
      name: 'Updated during repair',
    }),
  );
  assert.throws(() => stale.commit(), /过期/);
  const unchanged = editor.state.document;
  assert.throws(
    () =>
      dispatch(
        createRebindModifierInputCommand({
          ...request,
          reference: { ...original, operatorId: mirror.id },
        }),
      ),
    /依赖环/,
  );
  assert.deepEqual(
    editor.state.document,
    unchanged,
    'cycle rejection is atomic',
  );
  assert.throws(
    () =>
      dispatch(
        createRebindModifierInputCommand({
          ...request,
          reference: { ...original, domain: 'regions' },
        }),
      ),
    /类型不匹配/,
  );
  const independentSource = Object.values(
    editor.state.document.programs[independent.programId].operators,
  ).find((op) => op.type === 'source');
  const crossOwner = {
    ...original,
    ownerNodeId: independent.id,
    operatorId: independentSource.id,
  };
  assert.throws(
    () =>
      dispatch(
        createRebindModifierInputCommand({ ...request, reference: crossOwner }),
      ),
    /世界坐标/,
  );
  assert.deepEqual(editor.state.document, unchanged);
  const localOptions = runtime.readModifierInputs(
    runtime.project(),
    owner.id,
    mirror.id,
  ).inputs[0].options;
  assert(
    localOptions.every((option) => option.reference.ownerNodeId === owner.id),
    'local UI candidates cannot silently reinterpret another Shape frame',
  );
  assert(
    localOptions.every((option) => option.reference.operatorId !== mirror.id),
  );
  // Missing required bindings are repairable, including an entirely absent port.
  for (const missing of [[], undefined]) {
    dispatch((document) => {
      const op = document.programs[owner.programId].operators[mirror.id];
      if (missing) op.inputs.input = [];
      else delete op.inputs.input;
      return { document };
    });
    project = runtime.project();
    const missingView = runtime.readModifierInputs(
      project,
      owner.id,
      mirror.id,
    );
    assert.equal(missingView.inputs[0].reference, null);
    assert.equal(missingView.inputs[0].label, '缺少输入');
    const repairMissing = await runtime.prepareModifierInputRepair(request, {
      project,
    });
    assert.equal(repairMissing.ports.curves.status, 'ready');
    project = repairMissing.commit();
    assert.deepEqual(getProgram().operators[mirror.id].inputs.input, [
      original,
    ]);
    await assert.rejects(
      () =>
        runtime.prepareModifierInputRepair(
          { ...request, index: 1 },
          { project },
        ),
      /位置不存在/,
      'repair cannot append beyond declared cardinality',
    );
  }
  dispatch((document) => {
    document.nodes[independent.id].pose.translationMM = [100, 40];
    return { document };
  });
  project = runtime.project();
  const worldRepair = await runtime.prepareModifierInputRepair(
    { ...request, reference: { ...crossOwner, space: 'world-result' } },
    { project },
  );
  assert.equal(worldRepair.ports.curves.status, 'ready');
  assert(
    worldRepair.ports.curves.value.curves.some((curve) =>
      curve.edges.some((edge) =>
        edge.cubic.some(([x, y]) => Math.abs(x) > 100 || Math.abs(y) > 100),
      ),
    ),
    'an explicit world reference uses the producer pose',
  );
  worldRepair.cancel();
  // Fresh app/epoch cannot show snapshots from the prior project.
  editor.replaceDocument(createDocument({ version, idFactory }), {
    expectedRevision: editor.state.revision,
  });
  assert.throws(
    () => runtime.readModifierSnapshot(project, mirror.id, 'curves'),
    /过期/,
  );
  runtime.dispose();
}
console.log(
  'PASS chain recovery: local updates, independent branches, stale snapshots, explicit repair preview/commit/cancel/undo and revision isolation',
);
