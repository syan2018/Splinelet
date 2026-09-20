// Public-API-only authoring recipe. Call with window.traceStudio.call bound to
// its owner, after loading a COPY of the bundled example in an isolated page.
// Author one 45-degree sector. Mirror -> four rotations -> fill.
// Its outer and inner arcs end at DISTINCT points on the diagonal seam.
// Neither arc closes against the other: each continues into the neighbouring
// rotated/mirrored sector. BOTH seam joins are sharp corners; only the shoulders
// inside a sector are smooth. Do not align handles across a sector seam.
const point = (x, y) => ({ x, y });
const node = (co, left = co, right = co) => ({
  co: point(...co),
  handleLeft: point(...left),
  handleRight: point(...right),
});
export const emblemSplines = [
  {
    name: '金色标记 · 半边外弧',
    closed: false,
    role: 'guide',
    nodes: [
      node([0, 50], [0, 50], [4, 37]),
      node([11.8, 18], [12.8, 28], [10.8, 8]),
      node([4.8, 4.8], [6.5, 8]),
    ],
  },
  {
    name: '金色标记 · 半菱形镂空',
    closed: false,
    role: 'guide',
    nodes: [node([0, 35.5]), node([2.8, 30]), node([0, 24.5])],
  },
  {
    name: '金色标记 · 半边折角内弧',
    closed: false,
    role: 'guide',
    nodes: [
      node([0, 23]),
      node([3.2, 26.3]),
      node([7, 18], [5.1, 22.15], [8.9, 13.85]),
      node([2.5, 2.5], [4, 9]),
    ],
  },
];

export async function drawCupEmblem(
  call,
  { center = { x: 620, y: 947 }, scale = 2.35 } = {},
) {
  const initial = await call('creation_inspect');
  const cup = initial.creation.objects.find((o) => o.name === '杯子');
  if (!cup) throw Error('此示例需要包含“杯子”部件的实例工程');
  let state = await call('document.get');
  if (
    Object.values(state.document.nodes).some((o) => o.name === '金色四瓣标记')
  )
    throw Error('工程已有标记，请在新的副本中运行');
  // Every source/scene/program write uses an actually observed revision.
  const run = async (action) => {
    state = await call('authoring.run', {
      expectedRevision: state.revision,
      action,
    });
    return state;
  };
  const display = await call('state');
  const mmPerPixel = display.widthMM / display.image.width;
  const size = scale * mmPerPixel;
  const centerMM = [
    (center.x - display.image.width / 2) * mmPerPixel,
    (display.image.height / 2 - center.y) * mmPerPixel,
  ];
  await run({ kind: 'create-shape', name: '金色四瓣标记' });
  const objectId = state.lastChange.selectionIntent.activeRef.id;
  const pathRefs = [];
  for (const spline of emblemSplines) {
    const world = (point) => [point.x * size, point.y * size];
    await run({
      kind: 'draw-path',
      ownerNodeId: objectId,
      name: spline.name,
      closed: false,
      points: spline.nodes.map((node) => world(node.co)),
      cubics: spline.nodes
        .slice(0, -1)
        .map((node, index) =>
          [
            node.co,
            node.handleRight,
            spline.nodes[index + 1].handleLeft,
            spline.nodes[index + 1].co,
          ].map(world),
        ),
    });
    pathRefs.push(
      state.lastChange.changedRefs.find((ref) => ref.kind === 'path'),
    );
  }
  for (const [pathRef, index] of [
    [pathRefs[0], 1],
    [pathRefs[2], 2],
  ]) {
    const sketch = state.document.sketches[pathRef.sketchId];
    const vertexId =
      sketch.edges[sketch.paths[pathRef.id].edges[index].edgeId].startVertexId;
    await run({
      kind: 'set-path-handle-mode',
      sketchId: sketch.id,
      pathId: pathRef.id,
      vertexId,
      mode: 'smooth',
    });
  }
  const endpoint = (pathRef, end, mirrorIndex, index) => {
    const sketch = state.document.sketches[pathRef.sketchId];
    const uses = sketch.paths[pathRef.id].edges;
    return {
      edgeEnd: {
        kind: 'edge-end',
        sketchId: sketch.id,
        edgeId: (end === 'start' ? uses[0] : uses.at(-1)).edgeId,
        end,
      },
      mirrorIndex,
      index,
      wrap: true,
    };
  };
  // Neither eighth closes itself. Sharp seams retain independent handles.
  const connections = pathRefs.flatMap((pathRef, index) => [
    {
      a: endpoint(pathRef, 'start', 0, 'each'),
      b: endpoint(pathRef, 'start', 1, 'each'),
    },
    {
      a: endpoint(pathRef, 'end', 1, 'each'),
      b: endpoint(pathRef, 'end', 0, index === 1 ? 'each' : 'next'),
    },
  ]);
  await run({
    kind: 'repeat-pattern',
    ownerNodeId: objectId,
    center: [0, 0],
    mirror: { angleRad: Math.PI / 2 },
    count: 4,
    angleRad: Math.PI / 2,
    connections,
  });
  await run({
    kind: 'rotate-nodes',
    nodeIds: [objectId],
    angleRad: (29.5 * Math.PI) / 180,
    centerMM: [0, 0],
  });
  await run({ kind: 'move-nodes', nodeIds: [objectId], deltaMM: centerMM });
  await run({ kind: 'create-swatch', name: '金色标记', color: '#c3a264' });
  const swatchId = Object.values(state.document.appearances.swatches).find(
    (swatch) => swatch.name === '金色标记',
  ).id;
  await run({ kind: 'set-default-appearance', nodeId: objectId, swatchId });
  const evaluated = await call('evaluation.request', {
    epoch: state.epoch,
    revision: state.revision,
    domains: ['regions'],
  });
  const regions = evaluated.result.snapshot.regions
    .flatMap((stage) => stage.value?.regions || [])
    .filter((region) => region.ref.ownerNodeId === objectId);
  if (regions.length !== 1 || regions[0].geometry.coordinates.length !== 6)
    throw Error('显式连接未生成带中央孔和四个装饰孔的图样');
  const cupCells = initial.cells.filter(
    (cell) => cell.objectId === cup.id && cell.enabled,
  );
  const thickness = Math.max(...cupCells.map((cell) => cell.heightMM));
  for (const region of regions)
    await run({
      kind: 'set-relief',
      target: region.ref,
      value: {
        enabled: true,
        thickness: { kind: 'mm', value: thickness },
        mode: 'add',
        placement: cup.printLayerId
          ? { kind: 'layer', layerId: cup.printLayerId, offsetMM: 0 }
          : { kind: 'free', zMM: cup.zMM || 0 },
      },
    });
  const scene = await call('creation_inspect');
  const errors = scene.errors.filter((error) => error.objectId === objectId);
  if (errors.length) throw Error(JSON.stringify(errors));
  await call('creation_view', { view: '3d' });
  return {
    objectId,
    pathRefs,
    pathIds: scene.creation.objects.find((object) => object.id === objectId)
      .pathIds,
    modifierId: Object.values(
      state.document.programs[state.document.nodes[objectId].programId]
        .operators,
    ).find((operator) => operator.type === 'curve-array').id,
  };
}
