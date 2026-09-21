const pixel = (x, y) => ({ x, y });

export const closedPath = (id = 'outline', groupId = 'legacy-group') => ({
  id,
  name: id,
  color: '#336699',
  curves: [
    [pixel(10, 20), pixel(20, 20), pixel(30, 20), pixel(40, 20)],
    [pixel(40, 20), pixel(40, 30), pixel(40, 40), pixel(40, 50)],
    [pixel(40, 50), pixel(30, 50), pixel(20, 50), pixel(10, 50)],
    [pixel(10, 50), pixel(10, 40), pixel(10, 30), pixel(10, 20)],
  ],
  start: pixel(10, 20),
  closed: true,
  visible: true,
  quality: 1,
  anchors: [pixel(10, 20), pixel(40, 20), pixel(40, 50), pixel(10, 50)],
  groupId,
});

const base = (version) => ({
  version,
  image: 'data:image/png;base64,iVBORw0KGgo=',
  imageName: 'legacy-reference.png',
  width: 100,
  height: 80,
  widthMM: 50,
  depthMM: 2,
  groups: [{ id: 'legacy-group', name: '旧整理组' }],
  paths: [closedPath()],
});

export const v1Project = () => base(1);

export const v2SharedProject = () => ({
  ...base(2),
  creation: {
    version: 1,
    swatches: [{ id: 'blue', name: '蓝', color: '#336699' }],
    objects: [
      {
        id: 'left',
        name: '左',
        pathIds: ['outline'],
        roles: {},
        featureIds: [],
        regionIds: [],
        featureSwatches: {},
        swatchId: 'blue',
        heightMM: 2,
        zMM: 0,
        visible: true,
        printable: true,
        paints: [],
      },
      {
        id: 'right',
        name: '右',
        pathIds: ['outline'],
        roles: {},
        featureIds: [],
        regionIds: [],
        featureSwatches: {},
        swatchId: 'blue',
        heightMM: 3,
        zMM: 1,
        visible: true,
        printable: true,
        paints: [],
      },
    ],
  },
});

export const v3ProgramProject = () => ({
  ...base(3),
  model: {
    version: 1,
    toleranceMM: 0.02,
    manufacturingMM: 0,
    slicerTemplate: {
      version: 1,
      kind: 'bambu',
      name: '测试',
      application: 'BambuStudio',
      settings: { filament_settings_id: ['PLA'] },
    },
    regions: [
      {
        id: 'face',
        name: '正面',
        kind: 'path',
        pathId: 'outline',
        color: '#336699',
      },
    ],
    features: [
      {
        id: 'body',
        name: '主体',
        regionId: 'face',
        partId: 'main',
        mode: 'add',
        zMM: 0.4,
        heightMM: 1.2,
        heightLayers: 6,
        enabled: true,
        color: '#336699',
      },
    ],
    parts: [{ id: 'main', name: '主零件' }],
  },
  creation: {
    version: 1,
    swatches: [{ id: 'blue', name: '蓝', color: '#336699' }],
    printStack: {
      version: 1,
      layerHeightMM: 0.2,
      layers: [{ id: 'top', name: '顶层' }],
    },
    objects: [
      {
        id: 'badge',
        name: '徽章',
        pathIds: ['outline'],
        roles: { outline: 'boundary' },
        featureIds: ['body'],
        regionIds: [],
        featureSwatches: { body: 'blue' },
        swatchId: 'blue',
        heightMM: 1,
        zMM: 0,
        visible: true,
        printable: true,
        printLayerId: 'top',
        paints: [],
        modifiers: [
          {
            id: 'expand',
            name: '外扩',
            type: 'offset',
            enabled: false,
            targets: { kind: 'all' },
            distanceMM: 0.25,
          },
        ],
        sources: {},
        surfaceGraph: {
          version: 1,
          outputs: [
            {
              key: 'badge:surface:1',
              signature: 'outline+',
              style: { swatchId: 'blue', heightMM: 1.4, zOffsetMM: 0.1 },
            },
          ],
        },
      },
    ],
  },
});

export const unsupportedProject = () => {
  const value = v3ProgramProject();
  value.creation.objects[0].modifiers = [
    {
      id: 'mystery',
      name: '未知',
      type: 'warp',
      enabled: true,
      targets: { kind: 'all' },
    },
  ];
  return value;
};

export const ambiguousPaintProject = () => {
  const value = v3ProgramProject();
  value.creation.objects[0].paints = [
    {
      id: 'spatial-only',
      swatchId: 'blue',
      heightMM: 1,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    },
  ];
  return value;
};
