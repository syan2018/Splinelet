import { validateModel } from './model-schema.mjs';
import { validateCreation } from './creation-schema.mjs';
import type { SurfaceModifier } from './modifier-types';
import { saveThroughRuntime } from './platform/index.mjs';
import {
  exportSourceBlender,
  exportSourceSvg,
  sourcePathData,
} from './source-export.ts';
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
export function download(
  content: string | Uint8Array | ArrayBuffer,
  name: string,
  type: string,
) {
  void saveThroughRuntime(content, name, type).catch((error: unknown) => {
    window.alert(
      '保存文件失败：' +
        (error instanceof Error ? error.message : String(error)),
    );
  });
}
export function d(curves: ReadonlyArray<ReadonlyArray<Readonly<Point>>>) {
  return sourcePathData(curves);
}
export function svg(project: Project) {
  return exportSourceSvg(project);
}
export function blender(project: Project) {
  return exportSourceBlender(project);
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
