import { validateModel } from './model-schema.mjs';
import { validateCreation } from './creation-schema.mjs';
import type { SurfaceModifier } from './modifier-types';
export type Point = { x: number; y: number };
export type Cubic = [Point, Point, Point, Point];
export type TracePath = {
  id: string;
  name: string;
  color: string;
  curves: Cubic[];
  start: Point;
  closed: boolean;
  visible: boolean;
  quality: number;
  anchors: Point[];
  groupId?: string;
  nodeModes?: ('corner' | 'smooth' | 'symmetric')[];
  fitting?: 'single';
  fitError?: number;
};
export type RegionKind =
  | 'path'
  | 'split'
  | 'union'
  | 'difference'
  | 'intersection'
  | 'between'
  | 'stroke';
export type ModelRegion = {
  id: string;
  name: string;
  kind: RegionKind;
  color: string;
  pathId?: string;
  pathIds?: string[];
  a?: string;
  b?: string;
  baseId?: string;
  boundaryRegionId?: string;
  seed?: number[];
  expectedCount?: number;
  contourSignature?: string;
  seedWidthMM?: number;
  joinMM?: number;
  boundaryJoinMM?: number;
  widthMM?: number;
  close?: boolean;
  repair?: boolean;
  visible?: boolean;
};
export type ModelFeature = {
  id: string;
  name: string;
  regionId: string;
  partId: string;
  mode: 'add' | 'cut' | 'through';
  zMM: number;
  heightMM: number;
  heightLayers?: number;
  attachId?: string;
  enabled: boolean;
  color: string;
};
export type BambuSlicerTemplate = {
  version: 1;
  kind: 'bambu';
  name: string;
  application: string;
  settings: Record<string, unknown> & {
    printer_model?: string;
    printer_settings_id?: string;
    filament_settings_id: string[];
  };
};
export type ModelDocument = {
  version: 1;
  toleranceMM: number;
  manufacturingMM?: number;
  slicerTemplate?: BambuSlicerTemplate | null;
  regions: ModelRegion[];
  features: ModelFeature[];
  parts: { id: string; name: string }[];
};
export type CreationSwatch = { id: string; name: string; color: string };
export type CreationPrintStack = {
  version?: 1;
  layerHeightMM: number;
  layers: { id: string; name: string }[];
};
export type CreationPaint = {
  id: string;
  swatchId: string;
  heightMM: number;
  heightLayers?: number;
  zOffsetMM?: number;
  boundaryPathIds?: string[];
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
};
export type CreationObject = {
  id: string;
  name: string;
  pathIds: string[];
  featureIds?: string[];
  regionIds?: string[];
  roles: Record<string, string>;
  featureSwatches?: Record<string, string>;
  swatchId: string;
  heightMM: number;
  heightLayers?: number;
  zMM: number;
  attachId?: string;
  visible: boolean;
  printable?: boolean;
  printLayerId?: string;
  useObjectZ?: boolean;
  baseRegionIds?: string[];
  basePathIds?: string[];
  clipRegionIds?: string[];
  replacedFeatureIds?: string[];
  disabledClosureFeatureIds?: string[];
  dividerGraphCohorts?: string[][];
  legacyPartition?: boolean;
  offsetMM?: number;
  joinMM?: number;
  connectionDisabled?: Record<string, boolean>;
  paints?: CreationPaint[];
  modifiers?: SurfaceModifier[];
  sources?: Record<string, { regionId: string; modifiers: SurfaceModifier[] }>;
  surfaceGraph?: unknown;
};
export type CreationDocument = {
  version?: 1;
  swatches: CreationSwatch[];
  objects: CreationObject[];
  printStack?: CreationPrintStack;
};
export type Project = {
  version: 1 | 2 | 3;
  creation?: CreationDocument;
  model?: ModelDocument;
  image: string;
  imageName: string;
  width: number;
  height: number;
  paths: TracePath[];
  groups?: { id: string; name: string }[];
  widthMM: number;
  depthMM: number;
};
export const palette = [
  '#b8ef62',
  '#66d9ef',
  '#ffa872',
  '#e1a0ff',
  '#ff798f',
  '#ffdb72',
];
export function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const esc = (v: string) =>
  v.replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
const fmt = (v: number) => +v.toFixed(4);
export function d(curves: Cubic[]) {
  return curves.length
    ? `M ${fmt(curves[0][0].x)} ${fmt(curves[0][0].y)} ` +
        curves
          .map(
            (c) =>
              `C ${c
                .slice(1)
                .map((p) => `${fmt(p.x)} ${fmt(p.y)}`)
                .join(' ')}`,
          )
          .join(' ')
    : '';
}
export function svg(project: Project) {
  const render = (p: TracePath) =>
    `<path id="${esc(p.id)}" data-name="${esc(p.name)}" d="${d(p.curves)}${p.closed ? ' Z' : ''}" fill="none" stroke="${p.color}" stroke-width="1"/>`;
  const paths = project.paths.filter((p) => p.visible && p.curves.length);
  const content = [...(project.groups || []), { id: '', name: '未分组' }]
    .map((g) => {
      const body = paths
        .filter((p) => (p.groupId || '') === g.id)
        .map(render)
        .join('\n');
      return !body
        ? ''
        : g.id
          ? `<g id="group-${esc(g.id)}" data-name="${esc(g.name)}">\n${body}\n</g>`
          : body;
    })
    .filter(Boolean)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${project.widthMM}mm" height="${fmt((project.widthMM * project.height) / project.width)}mm" viewBox="0 0 ${project.width} ${project.height}"><title>描迹 · 可编辑贝塞尔曲线</title>\n${content}\n</svg>`;
}
export function blender(project: Project) {
  const data = {
    width: project.width,
    height: project.height,
    widthMM: project.widthMM,
    depthMM: project.depthMM,
    groups: project.groups || [],
    paths: project.paths.filter((p) => p.visible && p.curves.length),
  };
  return `# 描迹 / Blender 4.x and 5.x\n# Scripting > New > paste or open this file > Run Script.\n# Imports into a NEW collection; existing objects remain intact.\n# Closed curves are filled and extruded; open strokes remain editable curves.\nimport bpy, json\nDATA = json.loads(${JSON.stringify(JSON.stringify(data))})\nscale = DATA['widthMM'] / DATA['width'] / 1000.0\ncollection = bpy.data.collections.new('描迹 · Imported curves')\nbpy.context.scene.collection.children.link(collection)\ngroup_collections = {}\nfor group in DATA.get('groups', []):\n    child = bpy.data.collections.new(group['name'])\n    collection.children.link(child)\n    group_collections[group['id']] = child\nbpy.context.scene.unit_settings.system = 'METRIC'\nbpy.context.scene.unit_settings.scale_length = 1.0\nbpy.context.scene.unit_settings.length_unit = 'MILLIMETERS'\ndef point(p):\n    return ((p['x']-DATA['width']/2)*scale, (DATA['height']/2-p['y'])*scale, 0)\nfor item in DATA['paths']:\n    spans = item['curves']\n    curve = bpy.data.curves.new(item['name'], 'CURVE')\n    curve.dimensions = '2D'\n    curve.resolution_u = 24\n    curve.render_resolution_u = 32\n    curve.fill_mode = 'BOTH' if item['closed'] else 'NONE'\n    curve.extrude = DATA['depthMM']/2000.0 if item['closed'] else 0\n    spline = curve.splines.new('BEZIER')\n    count = len(spans) if item['closed'] else len(spans)+1\n    spline.bezier_points.add(count-1)\n    spline.use_cyclic_u = item['closed']\n    for i, bp in enumerate(spline.bezier_points):\n        anchor = spans[i][0] if i < len(spans) else spans[-1][3]\n        bp.co = point(anchor)\n        bp.handle_left_type = 'FREE'\n        bp.handle_right_type = 'FREE'\n        bp.handle_left = point(spans[i-1][2]) if i > 0 else (point(spans[-1][2]) if item['closed'] else point(anchor))\n        bp.handle_right = point(spans[i][1]) if i < len(spans) else point(anchor)\n    obj = bpy.data.objects.new(item['name'], curve)\n    group_collections.get(item.get('groupId'), collection).objects.link(obj)\n    obj['node_modes'] = json.dumps(item.get('nodeModes', []))\n    obj['source'] = 'Bezier Studio'\n    obj['source_id'] = item['id']\n    obj['closed'] = item['closed']\n    obj['trace_quality'] = item['quality']\nprint('Imported', len(DATA['paths']), 'editable Bezier paths. Closed regions may overlap; review and combine before meshing or printing.')\n`;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateProject(value: unknown): Project {
  if (!isRecord(value)) throw Error('不是有效的描迹工程');
  const v = value as Project;
  if (
    ![1, 2, 3].includes(v?.version) ||
    typeof v.image !== 'string' ||
    !/^(data:image\/(png|jpeg|webp);base64,|\/reference.png$)/.test(v.image) ||
    !Number.isFinite(v.width) ||
    v.width < 1 ||
    v.width > 12000 ||
    !Number.isFinite(v.height) ||
    v.height < 1 ||
    v.height > 12000 ||
    !Array.isArray(v.paths) ||
    v.paths.length > 1000 ||
    !Number.isFinite(v.widthMM) ||
    v.widthMM <= 0 ||
    v.widthMM > 10000 ||
    !Number.isFinite(v.depthMM) ||
    v.depthMM < 0 ||
    v.depthMM > 1000
  )
    throw Error('不是有效的描迹工程');
  const point = (p: unknown): p is Point =>
    isRecord(p) &&
    typeof p.x === 'number' &&
    typeof p.y === 'number' &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Math.abs(p.x) < 1e6 &&
    Math.abs(p.y) < 1e6;
  if (
    v.groups !== undefined &&
    (!Array.isArray(v.groups) ||
      v.groups.length > 1000 ||
      v.groups.some(
        (g) =>
          typeof g.id !== 'string' ||
          typeof g.name !== 'string' ||
          !g.name.trim(),
      ) ||
      new Set(v.groups.map((g) => g.id)).size !== v.groups.length)
  )
    throw Error('工程分组无效');
  for (const p of v.paths) {
    if (
      p.groupId !== undefined &&
      !(v.groups || []).some((g) => g.id === p.groupId)
    )
      throw Error('路径引用的分组不存在');
    if (
      p.nodeModes !== undefined &&
      (!Array.isArray(p.nodeModes) ||
        p.nodeModes.length !==
          (p.closed ? p.curves?.length : p.curves?.length + 1) ||
        p.nodeModes.some((m) => !['corner', 'smooth', 'symmetric'].includes(m)))
    )
      throw Error('节点连续模式无效');
    if (
      typeof p.id !== 'string' ||
      typeof p.name !== 'string' ||
      !/^#[a-fA-F0-9]{6}$/.test(p.color) ||
      typeof p.closed !== 'boolean' ||
      typeof p.visible !== 'boolean' ||
      !Array.isArray(p.curves) ||
      p.curves.length > 10000 ||
      !p.curves.every(
        (c) => Array.isArray(c) && c.length === 4 && c.every(point),
      ) ||
      !point(p.start) ||
      !Array.isArray(p.anchors) ||
      !p.anchors.every(point)
    )
      throw Error('工程包含无效曲线');
    for (let i = 1; i < p.curves.length; i++)
      if (
        Math.hypot(
          p.curves[i][0].x - p.curves[i - 1][3].x,
          p.curves[i][0].y - p.curves[i - 1][3].y,
        ) > 0.01
      )
        throw Error('曲线连接不连续');
    if (
      p.closed &&
      p.curves.length &&
      Math.hypot(
        p.curves[0]![0].x - p.curves.at(-1)![3].x,
        p.curves[0]![0].y - p.curves.at(-1)![3].y,
      ) > 0.01
    )
      throw Error('闭合路径存在缺口');
  }
  if (v.model !== undefined) validateModel(v.model);
  if (v.creation !== undefined) validateCreation(v.creation);
  return v;
}
export function db(
  action: 'get' | 'put',
  value?: Project,
): Promise<Project | IDBValidKey | undefined> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('bezier-studio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('workspace');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result,
        t = db.transaction(
          'workspace',
          action === 'put' ? 'readwrite' : 'readonly',
        ),
        s = t.objectStore('workspace'),
        q = action === 'put' ? s.put(value, 'current') : s.get('current');
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
      t.oncomplete = () => db.close();
    };
  });
}
