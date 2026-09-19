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
  let scene = await call('creation_inspect');
  const cup = scene.creation.objects.find((o) => o.name === '杯子');
  if (!cup) throw Error('此示例需要包含“杯子”部件的实例工程');
  if (scene.creation.objects.some((o) => o.name === '金色四瓣标记'))
    throw Error('工程已有标记，请编辑现有母瓣或在新的副本中运行');
  const before = new Set(scene.creation.objects.map((o) => o.id));
  await call('creation_command', {
    action: 'new_object',
    args: { name: '金色四瓣标记' },
  });
  scene = await call('creation_inspect');
  const objectId = scene.creation.objects.find((o) => !before.has(o.id)).id;
  const state = await call('state');
  const mmPerPixel = state.widthMM / state.image.width;
  const centerMM = {
    x: (center.x - state.image.width / 2) * mmPerPixel,
    y: (state.image.height / 2 - center.y) * mmPerPixel,
  };
  const rotationDeg = 29.5;
  const angle = (rotationDeg * Math.PI) / 180,
    size = scale * mmPerPixel;
  const { pathIds } = await call('spline_apply', {
    objectId,
    units: 'model',
    splines: emblemSplines.map((s) => ({
      ...s,
      matrix: [
        Math.cos(angle) * size,
        Math.sin(angle) * size,
        -Math.sin(angle) * size,
        Math.cos(angle) * size,
        centerMM.x,
        centerMM.y,
      ],
    })),
  });
  // Keep shoulder handles aligned during later GUI edits. Seam ends, tips and
  // decorative notches remain independent corner nodes.
  for (const [pathId, nodeIndex] of [
    [pathIds[0], 1],
    [pathIds[2], 2],
  ])
    await call('set_node_mode', { pathId, nodeIndex, mode: 'smooth' });
  scene = await call('creation_inspect');
  for (const args of [
    {
      type: 'curve_mirror',
      name: '半边镜像 · 严格对称',
      angleDeg: 90 + rotationDeg,
      centerMM,
    },
    {
      type: 'curve_array',
      name: '四向旋转 · 4 × 90°',
      count: 4,
      angleDeg: 90,
      centerMM,
    },
    { type: 'fill', name: '闭合构面 · 外环与镂空', joinMM: 0.001 },
  ]) {
    await call('creation_command', {
      action: 'modifier_add',
      args: { objectId, ...args },
    });
    scene = await call('creation_inspect');
    const issue = scene.errors.find((e) => e.objectId === objectId);
    if (issue) throw Error(issue.message);
  }
  await call('creation_command', {
    action: 'paint',
    revision: scene.revision,
    args: { objectIds: [objectId], color: '#c3a264' },
  });
  scene = await call('creation_inspect');
  if (scene.creation.printStack) {
    await call('creation_command', {
      action: 'print_assign',
      args: { objectIds: [objectId], layerId: cup.printLayerId },
    });
    scene = await call('creation_inspect');
  }
  const cupTop = Math.max(
    ...scene.cells.filter((c) => c.objectId === cup.id).map((c) => c.heightMM),
  );
  const layerHeight = scene.creation.printStack?.layerHeightMM;
  await call('creation_command', {
    action: 'height',
    revision: scene.revision,
    args: {
      objectIds: [objectId],
      ...(layerHeight
        ? { heightLayers: Math.round(cupTop / layerHeight) }
        : { heightMM: cupTop }),
    },
  });
  scene = await call('creation_inspect');
  const errors = scene.errors.filter((e) => e.objectId === objectId);
  if (errors.length) throw Error(JSON.stringify(errors));
  await call('creation_view', { view: '3d' });
  return {
    objectId,
    pathIds,
    modifierId: scene.creation.objects
      .find((o) => o.id === objectId)
      .modifiers.find((m) => m.type === 'curve_array').id,
  };
}
