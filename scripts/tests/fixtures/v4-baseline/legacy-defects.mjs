const square = (id, groupId) => {
  const points = [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 30 },
    { x: 10, y: 30 },
    { x: 10, y: 10 },
  ];
  return {
    id,
    groupId,
    start: points[0],
    anchors: points.slice(0, -1),
    curves: points
      .slice(1)
      .map((end, index) => [points[index], points[index], end, end]),
    closed: true,
  };
};

export function legacyF01Fixture() {
  return {
    width: 100,
    widthMM: 100,
    paths: [square('array-source', 'left')],
    groups: [{ id: 'left' }],
    creation: {
      objects: [
        {
          id: 'array-object',
          pathIds: ['array-source'],
          paints: [],
          modifiers: [
            {
              id: 'array',
              type: 'curve_array',
              centerMM: { x: 25, y: 35 },
            },
          ],
        },
      ],
    },
    model: { regions: [] },
  };
}

export function legacyF02Fixture() {
  const object = (id, groupId, pathIds) => ({
    id,
    groupId,
    pathIds,
    roles: {},
    featureIds: [],
    regionIds: [],
    baseRegionIds: [],
    basePathIds: [],
    clipRegionIds: [],
    paints: [],
    modifiers: [],
    sources: {},
  });
  return {
    paths: [square('shared-source', 'left')],
    groups: [{ id: 'left' }, { id: 'right' }],
    creation: {
      objects: [
        object('left-object', 'left', ['shared-source']),
        object('right-object', 'right', []),
      ],
    },
    model: { regions: [], features: [] },
  };
}
