import { emptyModel } from '../../../src/lib/model-schema.mjs';
import { defaultSwatches } from '../../../src/lib/creation-schema.mjs';

export const rectangle = (id, x1, y1, x2, y2) => {
  const points = [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
    [x1, y1],
  ].map(([x, y]) => ({ x, y }));
  return {
    id,
    name: id,
    closed: true,
    visible: true,
    color: '#c2ed94',
    quality: 1,
    start: points[0],
    anchors: points.slice(0, -1),
    curves: points.slice(1).map((p, i) => [points[i], points[i], p, p]),
  };
};
export const surfaceObject = (id, pathIds, featureIds = []) => ({
  id,
  name: id,
  pathIds,
  featureIds,
  regionIds: [],
  roles: {},
  featureSwatches: {},
  swatchId: 'cream',
  heightMM: 2,
  zMM: 0,
  visible: true,
  printable: true,
  paints: [],
});
export function liveSurfaces() {
  const p = {
    version: 3,
    image: '/reference.png',
    imageName: 'live-surfaces',
    width: 100,
    height: 100,
    widthMM: 100,
    depthMM: 2,
    groups: [],
    paths: [
      rectangle('outer', 10, 10, 90, 90),
      rectangle('hole', 30, 30, 70, 70),
    ],
    model: emptyModel(),
    creation: { version: 1, swatches: defaultSwatches(), objects: [] },
  };
  p.model.regions.push({
    id: 'base',
    name: '有名字的区域',
    kind: 'path',
    pathId: 'outer',
    color: '#f3ead7',
  });
  p.model.features.push({
    id: 'body',
    name: '原有体块',
    regionId: 'base',
    partId: 'main',
    mode: 'add',
    zMM: 0,
    heightMM: 2,
    color: '#f3ead7',
    enabled: true,
  });
  const o = surfaceObject('owner', ['outer', 'hole'], ['body']);
  o.roles.hole = 'hole';
  o.featureSwatches.body = 'cream';
  p.creation.objects.push(o);
  return p;
}
