'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Undo2,
  Redo2,
  Download,
  ArrowLeftRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { type Project, d, download, blender, palette } from '@/lib/project';
import {
  emptyModel,
  validateModel,
  regionDependants,
  featureDependants,
} from '@/lib/model-schema.mjs';
import { regionSVGPath } from '@/lib/geometry-format.mjs';
import { meshSTL } from '@/lib/mesh-format.mjs';
import { deliver3MF } from '@/lib/manufacturing-download';
import SlicerTemplate from '../shared/slicer-template';
import ReliefView from './relief-view';
import NumberEdit from '../shared/creation-number';
import {
  printCount,
  printMM,
  requestedPrintCount,
} from '@/lib/print-stack.mjs';
// @ts-expect-error Vite's explicit worker import also works through the RSC transform.
import ModelWorker from '../../lib/model-worker.ts?worker';

type Props = {
  project: Project;
  mode: string;
  onModel: (m: any) => void;
  onEditSource: (id: string) => void;
  onApi: (api: any) => void;
  onMode: (mode: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  status: (s: string) => void;
  initialPaths: string[];
};
const labels: any = {
  path: '闭合路径建面',
  split: '样条分区',
  union: '并集',
  difference: '相减',
  intersection: '交集',
  between: '两条曲线围面',
  stroke: '线条加宽成面',
};
function Rename({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value),
    done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (draft.trim() && draft.trim() !== value) onChange(draft.trim());
  };
  return editing ? (
    <input
      aria-label="对象名称"
      autoFocus
      value={draft}
      maxLength={200}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          done.current = true;
          setEditing(false);
        }
      }}
    />
  ) : (
    <span
      className="model-object-name"
      title="双击重命名"
      onDoubleClick={(e) => {
        e.stopPropagation();
        done.current = false;
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
    </span>
  );
}
const esc = (s: string) =>
  s.replace(
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
export default function ModelWorkspace(p: Props) {
  const model = p.project.model || emptyModel(),
    ref = useRef(p);
  ref.current = p;
  const worker = useRef<Worker | null>(null),
    pending = useRef(new Map<number, any>()),
    seq = useRef(0),
    [boot, setBoot] = useState(0);
  const [regions, setRegions] = useState<any[]>([]),
    [result, setResult] = useState<any>(null),
    [calculating, setCalculating] = useState(false),
    [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]),
    [sourceIds, setSourceIds] = useState<string[]>([]),
    [featureId, setFeatureId] = useState(''),
    [partId, setPartId] = useState('main');
  const [operation, setOperation] = useState('path'),
    [target, setTarget] = useState(''),
    [operand, setOperand] = useState(''),
    [joinMM, setJoinMM] = useState(0.15),
    [widthMM, setWidthMM] = useState(0.8),
    [close, setClose] = useState(false),
    [repair, setRepair] = useState(false);
  const [preview, setPreview] = useState<any>(null),
    previewRef = useRef<any>(null),
    previewGeneration = useRef(0),
    [chosen, setChosen] = useState<number[]>([]),
    [replaceId, setReplaceId] = useState(''),
    [working, setWorking] = useState(false),
    busy = useRef(false);
  const [search, setSearch] = useState(''),
    [opacity, setOpacity] = useState(35),
    [showSources, setShowSources] = useState(true),
    [deleteRequest, setDeleteRequest] = useState<any>(null),
    [tab, setTab] = useState('create');
  const [treeScope, setTreeScope] = useState('regions'),
    [treeSearch, setTreeSearch] = useState(''),
    rangeAnchor = useRef('');
  useEffect(() => {
    setDeleteRequest(null);
    if (p.mode !== 'faces') cancelPreviewOnly();
    if (p.mode !== 'trace')
      setTreeScope(p.mode === 'relief' ? 'features' : 'regions');
  }, [p.mode]);
  const [view, setView] = useState({ x: 0, y: 0, s: 1 }),
    viewRef = useRef(view),
    canvas = useRef<HTMLDivElement>(null),
    gesture = useRef<any>(null),
    [space, setSpace] = useState(false);
  viewRef.current = view;
  const [sidebarWidth, setSidebarWidth] = useState(360),
    resizeDrag = useRef<any>(null);
  const previewPanel = useRef<HTMLDivElement>(null),
    propertiesPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tab === 'create' && preview)
      previewPanel.current?.scrollIntoView({ block: 'nearest' });
    else if (propertiesPanel.current) propertiesPanel.current.scrollTop = 0;
  }, [tab, preview]);
  const resultRevision = useRef<Project | null>(null),
    regionRevision = useRef<Project | null>(null),
    runGeneration = useRef(0);
  const selectedRegion = regions.find((r) => r.id === selected.at(-1)),
    selectedSpec = model.regions.find((r: any) => r.id === selected.at(-1)),
    feature = model.features.find((f: any) => f.id === featureId);
  const commit = (m: any) => {
    validateModel(m);
    ref.current.onModel(m);
  };
  const mutate = (fn: (m: any) => void) => {
    const current = ref.current.project.model || emptyModel(),
      m = structuredClone(current);
    fn(m);
    if (JSON.stringify(m) !== JSON.stringify(current)) commit(m);
  };
  const rpc = (action: string, args: any = {}, project = ref.current.project) =>
    new Promise<any>((resolve, reject) => {
      if (!worker.current) {
        reject(Error('几何引擎尚未准备好'));
        return;
      }
      const id = ++seq.current;
      pending.current.set(id, { resolve, reject });
      worker.current.postMessage({
        id,
        action,
        project: { ...project, image: '' },
        args,
      });
    });
  useEffect(() => {
    const w = new ModelWorker() as Worker;
    worker.current = w;
    w.onmessage = ({ data }) => {
      const r = pending.current.get(data.id);
      if (!r) return;
      pending.current.delete(data.id);
      if (data.error) r.reject(Error(data.error));
      else r.resolve(data.result);
    };
    w.onerror = (e) => {
      setError('几何引擎加载失败：' + e.message);
      for (const q of pending.current.values())
        q.reject(Error('几何引擎加载失败'));
      pending.current.clear();
    };
    setBoot(1);
    return () => {
      w.terminate();
      worker.current = null;
      for (const q of pending.current.values())
        q.reject(Error('工作空间已关闭'));
      pending.current.clear();
    };
  }, []);
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem('bezier-model-sidebar'));
      if (w >= 280 && w <= 600) setSidebarWidth(w);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('bezier-model-sidebar', String(sidebarWidth));
    } catch {}
  }, [sidebarWidth]);
  useEffect(() => {
    setDeleteRequest(null);
    if (!model.parts.some((x: any) => x.id === partId))
      setPartId(model.parts[0]?.id || 'main');
    setSelected((ids) =>
      ids.filter((id) => model.regions.some((r: any) => r.id === id)),
    );
    if (!model.features.some((f: any) => f.id === featureId)) setFeatureId('');
    setSourceIds((ids) =>
      ids.filter((id) => p.project.paths.some((x) => x.id === id)),
    );
    if (previewRef.current && previewRef.current.revision !== p.project) {
      setPreview(null);
      previewRef.current = null;
      setChosen([]);
    }
  }, [p.project]);
  useEffect(() => {
    if (!boot || p.mode === 'trace') return;
    const generation = ++runGeneration.current,
      snapshot = p.project;
    let cancelled = false;
    setCalculating(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const r = await rpc('regions', {}, snapshot);
        if (cancelled || generation !== runGeneration.current) return;
        setRegions(r);
        regionRevision.current = snapshot;
        if (p.mode === 'relief') {
          if (
            !(snapshot.model?.features || []).some(
              (f: any) => f.enabled && f.partId === partId,
            )
          ) {
            setResult(null);
            resultRevision.current = null;
            return;
          }
          const solid = await rpc('solid', { partId }, snapshot);
          if (cancelled || generation !== runGeneration.current) return;
          setResult(solid);
          resultRevision.current = snapshot;
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message);
          resultRevision.current = null;
          setResult(null);
        }
      } finally {
        if (!cancelled) setCalculating(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [p.project, p.mode, partId, boot]);
  useEffect(() => {
    if (p.mode === 'faces' && p.initialPaths.length && !busy.current)
      setSourceIds(p.initialPaths);
  }, [p.mode]);
  function fit() {
    const el = canvas.current;
    if (!el) return;
    const r = el.getBoundingClientRect(),
      q = ref.current.project,
      s = Math.max(
        0.02,
        Math.min((r.width - 64) / q.width, (r.height - 64) / q.height),
      );
    setView({
      s,
      x: (r.width - q.width * s) / 2,
      y: (r.height - q.height * s) / 2,
    });
  }
  useEffect(() => {
    if (p.mode === 'faces') fit();
  }, [p.mode, p.project.width, p.project.height, p.project.image]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect(),
        x = e.clientX - b.left,
        y = e.clientY - b.top;
      setView((v) => {
        const s = Math.min(
          12,
          Math.max(0.02, v.s * Math.exp(-e.deltaY * 0.0015)),
        );
        return {
          s,
          x: x - ((x - v.x) * s) / v.s,
          y: y - ((y - v.y) * s) / v.s,
        };
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [p.mode]);
  const selectRegion = (id: string, add = false, range = false) => {
    const order = model.regions
      .filter((r: any) => r.name.includes(treeSearch))
      .map((r: any) => r.id);
    if (range && order.includes(rangeAnchor.current)) {
      const a = order.indexOf(rangeAnchor.current),
        b = order.indexOf(id);
      setSelected(order.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else {
      setSelected((ids) =>
        add
          ? ids.includes(id)
            ? ids.filter((x) => x !== id)
            : [...ids, id]
          : [id],
      );
      rangeAnchor.current = id;
    }
    setFeatureId('');
    setTab('object');
  };
  function cancel() {
    previewGeneration.current++;
    previewRef.current = null;
    setPreview(null);
    setChosen([]);
    setReplaceId('');
  }
  const run = async (fn: () => Promise<any>) => {
    if (busy.current) throw Error('请等待当前操作完成');
    busy.current = true;
    setWorking(true);
    setError('');
    try {
      return await fn();
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      busy.current = false;
      setWorking(false);
    }
  };
  const action = (fn: () => any) =>
    Promise.resolve()
      .then(fn)
      .catch((e) => setError(e.message));
  async function makePreview(spec?: any) {
    return run(async () => {
      const snapshot = ref.current.project;
      const draft = spec || {
        kind: operation,
        pathId: sourceIds[0],
        pathIds: sourceIds,
        a: target,
        b: operand,
        baseId: target,
        joinMM,
        widthMM,
        close,
        repair,
      };
      cancelPreviewOnly();
      const generation = previewGeneration.current;
      if (spec) {
        setOperation(spec.kind);
        setSourceIds(spec.pathIds || [spec.pathId].filter(Boolean));
        setTarget(spec.baseId || spec.a || '');
        setOperand(spec.b || '');
        setJoinMM(spec.joinMM ?? 0.15);
        setWidthMM(spec.widthMM ?? 0.8);
        setClose(!!spec.close);
        setRepair(!!spec.repair);
        setReplaceId('');
      }
      if (['path', 'stroke'].includes(draft.kind) && !draft.pathId)
        throw Error('请选择来源路径');
      if (draft.kind === 'between' && draft.pathIds?.length !== 2)
        throw Error('请选择两条路径');
      if (draft.kind === 'split' && (!draft.pathIds?.length || !draft.baseId))
        throw Error('请选择目标面和切分路径');
      const value = await rpc('preview', draft, snapshot);
      if (generation !== previewGeneration.current) return { cancelled: true };
      if (snapshot !== ref.current.project)
        throw Error('工程已改变，请重新预览');
      const prepared = { ...value, spec: draft, revision: snapshot };
      previewRef.current = prepared;
      setPreview(prepared);
      setChosen(draft.kind === 'split' ? [] : [0]);
      setTab('create');
      return {
        candidates: value.candidates,
        warnings: value.warnings,
        connections: value.connections,
      };
    });
  }
  function commitPreview(indices = chosen, name?: string) {
    const value = previewRef.current;
    if (!value || value.revision !== ref.current.project)
      throw Error('预览已过期，请重新计算');
    const ids = [...new Set(indices)];
    if (
      !ids.length ||
      ids.some((i) => !Number.isInteger(i) || !value.candidates[i])
    )
      throw Error('请点击或勾选需要保留的区域');
    if (replaceId && ids.length !== 1)
      throw Error('重新绑定已有面时，请只选择一块区域');
    const m = structuredClone(ref.current.project.model || emptyModel()),
      created: string[] = [];
    for (const i of ids) {
      const id = replaceId || crypto.randomUUID(),
        old = m.regions.find((r: any) => r.id === id),
        region = {
          ...value.spec,
          id,
          name:
            name?.trim() ||
            old?.name ||
            (value.spec.kind === 'path'
              ? ref.current.project.paths.find(
                  (x) => x.id === value.spec.pathId,
                )?.name
              : '') ||
            `${labels[value.spec.kind]} ${m.regions.length + 1}`,
          color: old?.color || palette[m.regions.length % palette.length],
        };
      if (value.spec.kind === 'split') {
        region.seed = value.candidates[i].seed;
        region.contourSignature = value.candidates[i].contourSignature;
        region.seedWidthMM = ref.current.project.widthMM;
        region.expectedCount = value.candidates.length;
      }
      if (old) m.regions[m.regions.indexOf(old)] = region;
      else m.regions.push(region);
      created.push(id);
    }
    commit(m);
    cancel();
    setSelected(created);
    setFeatureId('');
    setTab('object');
    p.status(`已建立 ${created.length} 个面 · 源样条保持原样 · 可撤销`);
    return { regionIds: created };
  }
  function addFeatures(args: any = {}) {
    const h = ref.current.project.creation?.printStack?.layerHeightMM;
    if (h) {
      const count = requestedPrintCount(
        args.heightLayers !== undefined || args.heightMM !== undefined
          ? args
          : { heightLayers: printCount(2, h) },
        h,
      );
      args = {
        ...args,
        heightMM: printMM(count, h),
        heightLayers: count,
        zMM: 0,
        attachId: '',
      };
    }
    const regionIds = args.regionIds || selected,
      m = structuredClone(ref.current.project.model || emptyModel());
    if (!Array.isArray(regionIds) || !regionIds.length)
      throw Error('请先选择一个或多个面');
    if (!m.parts.some((x: any) => x.id === (args.partId || partId)))
      throw Error('零件不存在');
    const created: string[] = [];
    for (const regionId of regionIds) {
      const r = m.regions.find((r: any) => r.id === regionId);
      if (!r) throw Error('面不存在');
      const id = crypto.randomUUID();
      m.features.push({
        id,
        name: r.name,
        regionId,
        partId: args.partId || partId,
        mode: args.mode || 'add',
        zMM: args.zMM ?? 0,
        heightMM: args.heightMM ?? 2,
        ...(h ? { heightLayers: args.heightLayers } : {}),
        attachId: args.attachId || '',
        enabled: true,
        color: r.color,
      });
      created.push(id);
    }
    commit(m);
    setFeatureId(created.at(-1)!);
    setTab('object');
    p.onMode('relief');
    return { featureIds: created };
  }
  function updateFeature(id: string, changes: any) {
    const h = ref.current.project.creation?.printStack?.layerHeightMM;
    if (h && ('heightMM' in changes || 'heightLayers' in changes)) {
      const count = requestedPrintCount(changes, h);
      changes = {
        ...changes,
        heightLayers: count,
        heightMM: printMM(count, h),
      };
    }
    if (h && (changes.attachId || ('zMM' in changes && !('mode' in changes))))
      throw Error('打印分层已接管起始高度，请在部件的所属堆叠层中调整');
    const allowed = [
      'name',
      'regionId',
      'partId',
      'mode',
      'zMM',
      'heightMM',
      'heightLayers',
      'attachId',
      'enabled',
      'color',
    ];
    if (Object.keys(changes).some((k) => !allowed.includes(k)))
      throw Error('未知体块属性');
    mutate((m) => {
      const f = m.features.find((f: any) => f.id === id);
      if (!f) throw Error('体块不存在');
      Object.assign(f, changes);
    });
    return { id };
  }
  function requestDelete(kind: string, ids: string[]) {
    if (
      !['region', 'feature'].includes(kind) ||
      !Array.isArray(ids) ||
      !ids.length
    )
      throw Error('请指定对象类型和 ID 列表');
    const objects =
      kind === 'region'
        ? ref.current.project.model?.regions || []
        : ref.current.project.model?.features || [];
    if (ids.some((id) => !objects.some((o: any) => o.id === id)))
      throw Error('要删除的对象不存在');
    const m = ref.current.project.model || emptyModel(),
      rs = kind === 'region' ? regionDependants(m, ids) : [],
      fs = featureDependants(
        m,
        kind === 'region'
          ? m.features
              .filter((f: any) => rs.includes(f.regionId))
              .map((f: any) => f.id)
          : ids,
      );
    if (rs.length + fs.length > ids.length) {
      setDeleteRequest({ rs, fs });
      return { confirmationRequired: true, regions: rs, features: fs };
    }
    erase(rs, fs);
    return { deleted: true };
  }
  function erase(rs: string[], fs: string[]) {
    mutate((m) => {
      m.regions = m.regions.filter((r: any) => !rs.includes(r.id));
      m.features = m.features.filter((f: any) => !fs.includes(f.id));
    });
    setDeleteRequest(null);
    cancel();
  }
  function reselect() {
    if (!selectedSpec) return;
    const s = selectedSpec;
    setOperation(s.kind);
    setSourceIds(s.pathIds || [s.pathId].filter(Boolean));
    setTarget(s.baseId || s.a || '');
    setOperand(s.b || '');
    setJoinMM(s.joinMM ?? 0.15);
    setClose(!!s.close);
    setRepair(!!s.repair);
    setWidthMM(s.widthMM || 0.8);
    setReplaceId(s.id);
    setTab('create');
    p.onMode('faces');
    cancelPreviewOnly();
  }
  function cancelPreviewOnly() {
    previewGeneration.current++;
    previewRef.current = null;
    setPreview(null);
    setChosen([]);
  }
  async function getSolid() {
    const snapshot = ref.current.project;
    if (
      result &&
      resultRevision.current === snapshot &&
      result.partId === partId
    )
      return result;
    const r = await rpc('solid', { partId }, snapshot);
    if (snapshot !== ref.current.project) throw Error('工程已改变，请重新导出');
    return r;
  }
  async function exportModel(format: string, save = true) {
    return run(async () => {
      const q = ref.current.project;
      if (format === 'svg') {
        const rs = await rpc('regions', {}, q);
        if (q !== ref.current.project) throw Error('工程已改变');
        const chosen = selected.length
          ? rs.filter((r: any) => selected.includes(r.id))
          : rs;
        if (!chosen.length || chosen.some((r: any) => r.error))
          throw Error('请先建立有效的面');
        const content = `<svg xmlns="http://www.w3.org/2000/svg" width="${q.widthMM}mm" height="${(q.widthMM * q.height) / q.width}mm" viewBox="0 0 ${q.width} ${q.height}"><title>Splinelet · 派生区域 · 精度 ${model.toleranceMM} mm</title>${chosen.map((r: any) => `<path id="${esc(r.id)}" data-name="${esc(r.name)}" fill="${r.color}" fill-rule="evenodd" d="${regionSVGPath(r.geometry, q)}"/>`).join('')}</svg>`;
        if (save) download(content, '构面结果.svg', 'image/svg+xml');
        return { filename: '构面结果.svg', content };
      }
      if (
        format === '3mf' ||
        format === '3mf-generic' ||
        format === '3mf-bambu'
      ) {
        if (format === '3mf-bambu' && !q.model?.slicerTemplate)
          throw Error('请先载入 Bambu Studio 配置模板');
        const result = await rpc(
          '3mf',
          {
            partId,
            slicerTemplate:
              format === '3mf-bambu' ? q.model?.slicerTemplate : null,
          },
          q,
        );
        if (q !== ref.current.project) throw Error('工程已改变，请重新导出');
        return deliver3MF(result, save);
      }
      const r = await getSolid();
      if (format === 'stl') {
        const buffer = meshSTL(r.mesh);
        if (save) {
          const url = URL.createObjectURL(
              new Blob([buffer], { type: 'model/stl' }),
            ),
            a = document.createElement('a');
          a.href = url;
          a.download =
            (model.parts.find((x: any) => x.id === partId)?.name || '浮雕') +
            '.stl';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
        return { report: r.report, mesh: r.mesh };
      }
      if (format !== 'blender') throw Error('格式必须是 svg、stl 或 blender');
      const mesh = JSON.stringify(r.mesh),
        content =
          blender({
            ...q,
            depthMM: 0,
            paths: q.paths.map((path) => ({ ...path, visible: true })),
          }) +
          `\n# Editable source curves plus the computed relief mesh (millimeters).\ncollection.hide_render=True\ncollection.hide_viewport=True\nRELIEF=json.loads(${JSON.stringify(mesh)})\nmodel_collection=bpy.data.collections.new('Splinelet · 浮雕实体')\nbpy.context.scene.collection.children.link(model_collection)\nmesh=bpy.data.meshes.new('浮雕实体')\nvs=RELIEF['positions'];ts=RELIEF['triangles']\nmesh.from_pydata([tuple(v*.001 for v in vs[i:i+3]) for i in range(0,len(vs),3)],[],[ts[i:i+3] for i in range(0,len(ts),3)])\nmesh.update()\nobj=bpy.data.objects.new('浮雕实体',mesh)\nmodel_collection.objects.link(obj)\nobj['geometry_report']=${JSON.stringify(JSON.stringify(r.report))}\n`;
      if (save) download(content, '浮雕与源曲线_blender.py', 'text/x-python');
      return { filename: '浮雕与源曲线_blender.py', content, report: r.report };
    });
  }
  useEffect(() => {
    p.onApi({
      show_output: () => {
        setTab('output');
        return { ok: true };
      },
      state: () => ({
        selectedRegions: selected,
        selectedFeature: featureId,
        partId,
        regions: regions.map(({ geometry: _geometry, ...r }) => r),
        preview: preview
          ? {
              candidates: preview.candidates.map(
                ({ geometry: _geometry, ...r }: any) => r,
              ),
              connections: preview.connections,
              warnings: preview.warnings,
            }
          : null,
        calculating,
        report: resultRevision.current === p.project ? result?.report : null,
        error,
      }),
      inspect_model: async () => ({
        regions: await rpc('regions'),
        model: ref.current.project.model || emptyModel(),
      }),
      preview_region: async (a: any) => {
        p.onMode('faces');
        return await makePreview(a);
      },
      commit_region_preview: (a: any) => commitPreview(a.indices, a.name),
      discard_region_preview: () => {
        cancel();
        return { ok: true };
      },
      select_regions: (a: any) => {
        if (
          !Array.isArray(a.regionIds) ||
          a.regionIds.some(
            (id: string) => !model.regions.some((r: any) => r.id === id),
          )
        )
          throw Error('regionIds 必须为现有面 ID');
        setSelected(a.regionIds);
        setFeatureId('');
        setTab('object');
        return { selectedRegions: a.regionIds };
      },
      create_relief: addFeatures,
      set_relief: (a: any) => updateFeature(a.id, a.changes),
      set_model_options: (a: any) => {
        if (
          Object.keys(a).some(
            (k) => !['toleranceMM', 'manufacturingMM'].includes(k),
          )
        )
          throw Error('未知模型选项');
        mutate((m) => Object.assign(m, a));
        return { ok: true };
      },
      create_part: (a: any) => {
        const id = crypto.randomUUID();
        mutate((m) =>
          m.parts.push({ id, name: a.name || '零件 ' + (m.parts.length + 1) }),
        );
        setPartId(id);
        return { id };
      },
      select_part: (a: any) => {
        if (!model.parts.some((x: any) => x.id === a.id))
          throw Error('零件不存在');
        setPartId(a.id);
        setFeatureId('');
        return { partId: a.id };
      },
      delete_model_object: (a: any) => requestDelete(a.kind, a.ids),
      validate_part: async (a: any) => {
        const r = await rpc('solid', { partId: a.partId || partId });
        return { report: r.report, warnings: r.warnings };
      },
      get_relief_mesh: async (a: any) =>
        await rpc('solid', { partId: a.partId || partId }),
      export_model: async (a: any) => await exportModel(a.format, false),
    });
  });
  useEffect(() => {
    if (p.mode === 'trace') return;
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable],[role="dialog"]',
        ) ||
        deleteRequest
      )
        return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'a') {
          e.preventDefault();
          setSelected(model.regions.map((r: any) => r.id));
        }
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setSpace(true);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (gesture.current) {
          setView(gesture.current.base);
          gesture.current = null;
        } else if (preview || working) cancel();
        else {
          setSelected([]);
          setFeatureId('');
        }
      }
      if (
        e.key === 'Enter' &&
        preview &&
        !(e.target as HTMLElement).closest('button,summary')
      ) {
        e.preventDefault();
        void action(() => commitPreview());
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (featureId) requestDelete('feature', [featureId]);
        else if (selected.length) requestDelete('region', selected);
      }
    };
    const up = (e: Event) => {
      if (e.type === 'blur' && gesture.current) {
        setView(gesture.current.base);
        gesture.current = null;
      }
      if (e.type === 'blur' || (e as KeyboardEvent).code === 'Space')
        setSpace(false);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', up);
    };
  });
  if (p.mode === 'trace') return null;
  const toggleSource = (id: string) => {
    cancelPreviewOnly();
    setSourceIds((ids) =>
      ['path', 'stroke'].includes(operation)
        ? [id]
        : ids.includes(id)
          ? ids.filter((x) => x !== id)
          : [...ids, id],
    );
  };
  const mmToImage = ([x, y]: number[]) => ({
    x: p.project.width / 2 + (x * p.project.width) / p.project.widthMM,
    y: p.project.height / 2 - (y * p.project.width) / p.project.widthMM,
  });
  const selectList = (
    value: string,
    onChange: (s: string) => void,
    exclude = '',
  ) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">请选择面</option>
      {model.regions
        .filter((r: any) => r.id !== exclude)
        .map((r: any) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
    </select>
  );
  return (
    <div className="model-workspace" data-workspace={p.mode}>
      <div className="model-center">
        <div className="model-toolbar">
          <b>{p.mode === 'faces' ? '构面' : '浮雕'}</b>
          <button aria-label="撤销模型操作" onClick={p.onUndo}>
            <Undo2 size={16} />
          </button>
          <button aria-label="重做模型操作" onClick={p.onRedo}>
            <Redo2 size={16} />
          </button>
          {p.mode === 'faces' ? (
            <>
              <button onClick={fit}>适应画布</button>
              <label>
                <input
                  type="checkbox"
                  checked={showSources}
                  onChange={(e) => setShowSources(e.target.checked)}
                />
                源线
              </label>
              <label>
                底图
                <input
                  aria-label="构面底图透明度"
                  type="range"
                  min={0}
                  max={100}
                  value={opacity}
                  onChange={(e) => setOpacity(+e.target.value)}
                />
              </label>
            </>
          ) : (
            <span>合并后的实际实体</span>
          )}
          <span className="model-compute">
            {working ? '正在计算预览…' : calculating ? '正在更新…' : ''}
          </span>
        </div>
        {p.mode === 'faces' ? (
          <div
            className="model-canvas"
            tabIndex={0}
            ref={canvas}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              if (e.button === 1 || e.button === 2 || space) {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                gesture.current = {
                  x: e.clientX,
                  y: e.clientY,
                  base: viewRef.current,
                };
              }
            }}
            onPointerMove={(e) => {
              const g = gesture.current;
              if (g)
                setView({
                  ...g.base,
                  x: g.base.x + e.clientX - g.x,
                  y: g.base.y + e.clientY - g.y,
                });
            }}
            onPointerUp={() => (gesture.current = null)}
            onPointerCancel={() => {
              if (gesture.current) setView(gesture.current.base);
              gesture.current = null;
            }}
          >
            <svg
              width="100%"
              height="100%"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setSelected([]);
                  setFeatureId('');
                }
              }}
            >
              <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>
                <image
                  href={p.project.image}
                  width={p.project.width}
                  height={p.project.height}
                  opacity={opacity / 100}
                  style={{ pointerEvents: 'none' }}
                />
                {regions
                  .filter(
                    (r) =>
                      !r.error &&
                      model.regions.find((x: any) => x.id === r.id)?.visible !==
                        false,
                  )
                  .map((r) => (
                    <path
                      key={r.id}
                      data-region-id={r.id}
                      d={regionSVGPath(r.geometry, p.project)}
                      fill={r.color}
                      fillOpacity={selected.includes(r.id) ? 0.45 : 0.15}
                      stroke={selected.includes(r.id) ? '#d4ff7e' : r.color}
                      strokeWidth={(selected.includes(r.id) ? 2.5 : 1) / view.s}
                      fillRule="evenodd"
                      onClick={(e) => {
                        if (space) return;
                        e.stopPropagation();
                        selectRegion(
                          r.id,
                          e.shiftKey || e.ctrlKey || e.metaKey,
                        );
                      }}
                    />
                  ))}
                {showSources &&
                  p.project.paths
                    .filter((x) => x.visible)
                    .map((path) => (
                      <path
                        key={path.id}
                        data-model-source={path.id}
                        d={d(path.curves) + (path.closed ? ' Z' : '')}
                        fill="none"
                        stroke={
                          sourceIds.includes(path.id) ? '#7cdeff' : '#ddd'
                        }
                        strokeOpacity={sourceIds.includes(path.id) ? 1 : 0.45}
                        strokeWidth={
                          (sourceIds.includes(path.id) ? 3 : 1) / view.s
                        }
                        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                        onClick={(e) => {
                          if (space) return;
                          e.stopPropagation();
                          toggleSource(path.id);
                          setTab('create');
                        }}
                        onDoubleClick={() => p.onEditSource(path.id)}
                      />
                    ))}
                {preview?.candidates.map((r: any, i: number) => {
                  const point = mmToImage(r.seed);
                  return (
                    <g key={i}>
                      <path
                        data-candidate-index={i}
                        d={regionSVGPath(r.geometry, p.project)}
                        fill={palette[i % palette.length]}
                        fillOpacity={chosen.includes(i) ? 0.78 : 0.3}
                        stroke={chosen.includes(i) ? '#fff' : '#d7e5e9'}
                        strokeWidth={1.5 / view.s}
                        fillRule="evenodd"
                        onClick={(e) => {
                          if (space) return;
                          e.stopPropagation();
                          setChosen((ids) =>
                            ids.includes(i)
                              ? ids.filter((x) => x !== i)
                              : [...ids, i],
                          );
                        }}
                      />
                      <text
                        x={point.x}
                        y={point.y}
                        fontSize={14 / view.s}
                        fill="#10202b"
                        stroke="#fff"
                        strokeWidth={3 / view.s}
                        paintOrder="stroke"
                        textAnchor="middle"
                        pointerEvents="none"
                      >
                        {i + 1}
                      </text>
                    </g>
                  );
                })}
                {preview?.connections.map((c: any, i: number) => {
                  const a = mmToImage(c.from),
                    b = mmToImage(c.to);
                  return (
                    <g key={i} pointerEvents="none">
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="#ffb25c"
                        strokeWidth={3 / view.s}
                      />
                      <circle
                        cx={b.x}
                        cy={b.y}
                        r={4 / view.s}
                        fill="none"
                        stroke="#ffb25c"
                        strokeWidth={1.5 / view.s}
                      />
                    </g>
                  );
                })}
              </g>
            </svg>
            <div className="model-view-hint">
              {preview
                ? '点击编号区域选择 · Enter 提交 · Esc 取消'
                : '点击面选择 · Shift 多选 · 点击源线选作工具 · 空格 / 中键平移'}
            </div>
          </div>
        ) : (
          <ReliefView result={result} />
        )}
        {error && (
          <div className="model-error" role="alert">
            {error}
          </div>
        )}
        <div className="model-status">
          {p.mode === 'faces'
            ? `${regions.length} 个面 · 派生区域精度 ${model.toleranceMM} mm · 源贝塞尔独立保留`
            : result
              ? `${result.report.sizeMM.map((v: number) => v.toFixed(2)).join(' × ')} mm · ${result.report.components} 个连通实体 · ${result.report.triangles.toLocaleString()} 个三角面`
              : '选择面 → 添加体块 → 设置高低'}
        </div>
      </div>
      <div
        className="model-resizer"
        role="separator"
        aria-label="调整建模侧栏宽度"
        aria-orientation="vertical"
        tabIndex={0}
        onDoubleClick={() => setSidebarWidth(360)}
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            setSidebarWidth((w) =>
              Math.min(
                600,
                Math.max(280, w + (e.key === 'ArrowLeft' ? 20 : -20)),
              ),
            );
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          resizeDrag.current = { x: e.clientX, width: sidebarWidth };
        }}
        onPointerMove={(e) => {
          if (resizeDrag.current)
            setSidebarWidth(
              Math.min(
                600,
                Math.max(
                  280,
                  resizeDrag.current.width + resizeDrag.current.x - e.clientX,
                ),
              ),
            );
        }}
        onPointerUp={() => (resizeDrag.current = null)}
      />
      <aside className="model-sidebar" style={{ width: sidebarWidth }}>
        <div className="model-tree">
          <div className="model-section-title">
            <b>面与体块</b>
            <span>{selected.length ? `已选 ${selected.length} 个面` : ''}</span>
            <button
              title="取消建模选择"
              onClick={() => {
                setSelected([]);
                setFeatureId('');
              }}
            >
              取消选择
            </button>
          </div>
          {!model.regions.length && (
            <p className="model-help">选择已有路径，预览并建立第一个面。</p>
          )}
          <div className="model-outliner-controls">
            <button
              aria-pressed={treeScope === 'regions'}
              onClick={() => setTreeScope('regions')}
            >
              面 · {model.regions.length}
            </button>
            <button
              aria-pressed={treeScope === 'features'}
              onClick={() => setTreeScope('features')}
            >
              体块 ·{' '}
              {model.features.filter((f: any) => f.partId === partId).length}
            </button>
            <input
              aria-label="搜索建模对象"
              placeholder="搜索对象"
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
            />
          </div>
          {treeScope === 'regions' && (
            <div
              className="model-tree-scroll"
              role="listbox"
              aria-label="区域列表"
              aria-multiselectable="true"
            >
              {model.regions
                .filter((r: any) => r.name.includes(treeSearch))
                .map((r: any) => (
                  <div
                    key={r.id}
                    className={
                      'model-tree-row ' +
                      (selected.includes(r.id) && !featureId ? 'selected' : '')
                    }
                    role="option"
                    aria-selected={selected.includes(r.id)}
                    data-region-row={r.id}
                    tabIndex={0}
                    onClick={(e) =>
                      selectRegion(r.id, e.ctrlKey || e.metaKey, e.shiftKey)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectRegion(r.id, e.shiftKey);
                      }
                    }}
                  >
                    <i style={{ background: r.color }} />
                    <Rename
                      value={r.name}
                      onChange={(name) =>
                        mutate(
                          (m) =>
                            (m.regions.find((x: any) => x.id === r.id).name =
                              name),
                        )
                      }
                    />
                    {regions.find((x) => x.id === r.id)?.error && (
                      <span
                        className="model-invalid"
                        title={regions.find((x) => x.id === r.id)?.error}
                      >
                        !
                      </span>
                    )}
                    <button
                      aria-label={`${r.name}显示`}
                      onClick={(e) => {
                        e.stopPropagation();
                        mutate((m) => {
                          const o = m.regions.find((x: any) => x.id === r.id);
                          o.visible = o.visible === false;
                        });
                      }}
                    >
                      {r.visible === false ? (
                        <EyeOff size={14} />
                      ) : (
                        <Eye size={14} />
                      )}
                    </button>
                  </div>
                ))}
            </div>
          )}
          {treeScope === 'features' && (
            <>
              <div className="model-part-heading">
                <select
                  aria-label="当前零件"
                  value={partId}
                  onChange={(e) => {
                    setPartId(e.target.value);
                    setFeatureId('');
                  }}
                >
                  {model.parts.map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <button
                  aria-label="新建零件"
                  onClick={() => {
                    const id = crypto.randomUUID();
                    mutate((m) =>
                      m.parts.push({
                        id,
                        name: '零件 ' + (m.parts.length + 1),
                      }),
                    );
                    setPartId(id);
                  }}
                >
                  <Plus size={15} />
                </button>
              </div>
              <div className="model-feature-scroll">
                {model.features
                  .filter(
                    (f: any) =>
                      f.partId === partId && f.name.includes(treeSearch),
                  )
                  .map((f: any) => (
                    <div
                      key={f.id}
                      className={
                        'model-tree-row ' +
                        (featureId === f.id ? 'selected' : '')
                      }
                      data-feature-row={f.id}
                      onClick={() => {
                        setFeatureId(f.id);
                        setSelected([f.regionId]);
                        setTab('object');
                      }}
                    >
                      <input
                        aria-label={`启用${f.name}`}
                        type="checkbox"
                        checked={f.enabled}
                        onChange={(e) =>
                          updateFeature(f.id, { enabled: e.target.checked })
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="model-kind">
                        {f.mode === 'add' ? '+' : f.mode === 'cut' ? '−' : '穿'}
                      </span>
                      <Rename
                        value={f.name}
                        onChange={(name) => updateFeature(f.id, { name })}
                      />
                      <small>
                        {f.mode === 'through'
                          ? '贯穿'
                          : Number(f.heightMM.toFixed(3)) + ' mm'}
                      </small>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
        <div className="model-tabs" role="tablist" aria-label="建模属性">
          {[
            ['create', '构面'],
            ['object', '对象'],
            ['output', '制造 / 导出'],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="model-properties" ref={propertiesPanel}>
          {tab === 'create' && (
            <>
              {replaceId && (
                <div className="model-notice">
                  正在重新绑定「{selectedSpec?.name}」，只选择一个候选面。
                  <button onClick={cancel}>取消重绑</button>
                </div>
              )}
              <div onChangeCapture={() => cancelPreviewOnly()}>
                <label className="model-field">
                  构面操作
                  <select
                    aria-label="构面操作"
                    value={operation}
                    onChange={(e) => {
                      setOperation(e.target.value);
                      cancelPreviewOnly();
                      setTarget(selected[0] || '');
                      setOperand(selected[1] || '');
                    }}
                  >
                    {Object.entries(labels).map(([k, v]) => (
                      <option key={k} value={k}>
                        {String(v)}
                      </option>
                    ))}
                  </select>
                </label>
                {['split', 'union', 'difference', 'intersection'].includes(
                  operation,
                ) && (
                  <label className="model-field">
                    {operation === 'split' ? '待切分的面' : '目标面 A'}
                    {selectList(target, setTarget)}
                  </label>
                )}
                {['union', 'difference', 'intersection'].includes(
                  operation,
                ) && (
                  <>
                    <label className="model-field">
                      工具面 B{selectList(operand, setOperand, target)}
                    </label>
                    <button
                      onClick={() => {
                        cancelPreviewOnly();
                        setTarget(operand);
                        setOperand(target);
                      }}
                    >
                      <ArrowLeftRight size={14} />
                      交换 A / B
                    </button>
                    {operation === 'difference' && (
                      <p className="model-help">
                        保留 A，扣去与 B 重叠的面积。源面仍可编辑。
                      </p>
                    )}
                  </>
                )}
                {['path', 'split', 'between', 'stroke'].includes(operation) && (
                  <div className="model-source-picker">
                    <div className="model-section-title">
                      <b>{operation === 'split' ? '切分路径' : '来源路径'}</b>
                      <span>{sourceIds.length} 条</span>
                      <button
                        onClick={() => {
                          cancelPreviewOnly();
                          setSourceIds([]);
                        }}
                      >
                        清空
                      </button>
                    </div>
                    <input
                      aria-label="搜索来源路径"
                      placeholder="搜索名称或分组"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <div>
                      {p.project.paths
                        .filter((path) => {
                          const group =
                            p.project.groups?.find((g) => g.id === path.groupId)
                              ?.name || '';
                          return (path.name + ' ' + group).includes(search);
                        })
                        .map((path) => (
                          <label key={path.id} title="双击名称编辑源样条">
                            <input
                              type="checkbox"
                              checked={sourceIds.includes(path.id)}
                              onChange={() => {
                                if (['path', 'stroke'].includes(operation))
                                  setSourceIds([path.id]);
                                else toggleSource(path.id);
                              }}
                            />
                            <span onDoubleClick={() => p.onEditSource(path.id)}>
                              {path.name}
                            </span>
                            <small>{path.closed ? '闭合' : '开放'}</small>
                          </label>
                        ))}
                    </div>
                  </div>
                )}
                {operation === 'split' && (
                  <label className="model-field">
                    端点接边距离（mm）
                    <input
                      aria-label="接边距离"
                      type="number"
                      min={0}
                      max={5}
                      step={0.05}
                      value={joinMM}
                      onChange={(e) => setJoinMM(+e.target.value)}
                    />
                    <small>仅预览中橙色连接会用于构面，不移动源节点。</small>
                  </label>
                )}
                {operation === 'path' && (
                  <label className="model-check">
                    <input
                      type="checkbox"
                      checked={close}
                      onChange={(e) => setClose(e.target.checked)}
                    />
                    补齐开放路径首尾（预览连接）
                  </label>
                )}
                {operation === 'stroke' && (
                  <label className="model-field">
                    线宽（mm）
                    <input
                      type="number"
                      min={0.01}
                      max={100}
                      step={0.1}
                      value={widthMM}
                      onChange={(e) => setWidthMM(+e.target.value)}
                    />
                  </label>
                )}
                {operation !== 'split' && (
                  <label className="model-check">
                    <input
                      type="checkbox"
                      checked={repair}
                      onChange={(e) => setRepair(e.target.checked)}
                    />
                    预览修复自交（仅派生区域）
                  </label>
                )}
              </div>
              <button
                className="primary model-full"
                disabled={working || calculating}
                onClick={() => action(() => makePreview())}
              >
                预览区域
              </button>
              {preview && (
                <div className="model-preview-panel" ref={previewPanel}>
                  <b>{preview.candidates.length} 个候选区域</b>
                  <div className="model-inline">
                    <button
                      onClick={() =>
                        setChosen(
                          preview.candidates.map((_: any, i: number) => i),
                        )
                      }
                    >
                      全选
                    </button>
                    <button onClick={() => setChosen([])}>清空</button>
                  </div>
                  {preview.candidates.map((r: any, i: number) => (
                    <label key={i} className="model-candidate">
                      <input
                        type="checkbox"
                        checked={chosen.includes(i)}
                        onChange={() =>
                          setChosen((ids) =>
                            ids.includes(i)
                              ? ids.filter((x) => x !== i)
                              : [...ids, i],
                          )
                        }
                      />
                      <i style={{ background: palette[i % palette.length] }} />
                      {i + 1}
                      <span>
                        {r.areaMM2.toFixed(2)} mm² · {r.holes} 孔
                      </span>
                    </label>
                  ))}
                  {preview.connections.length > 0 && (
                    <details>
                      <summary>
                        {preview.connections.length} 处连接，最大{' '}
                        {Math.max(
                          ...preview.connections.map((c: any) => c.gapMM),
                        ).toFixed(3)}{' '}
                        mm
                      </summary>
                      {preview.connections.map((c: any, i: number) => (
                        <p key={i}>
                          {p.project.paths.find((x) => x.id === c.pathId)
                            ?.name || '轮廓首尾'}
                          ：{c.gapMM.toFixed(3)} mm
                        </p>
                      ))}
                    </details>
                  )}
                  {preview.warnings.map((s: string, i: number) => (
                    <p className="model-notice" key={i}>
                      {s}
                    </p>
                  ))}
                  <div className="model-inline">
                    <button
                      className="primary"
                      disabled={!chosen.length || working}
                      onClick={() => action(() => commitPreview())}
                    >
                      {replaceId ? '重新绑定面' : '建立所选面'} ·{' '}
                      {chosen.length}
                    </button>
                    <button onClick={cancel}>取消</button>
                  </div>
                </div>
              )}
            </>
          )}
          {tab === 'object' && (
            <>
              {feature ? (
                <>
                  <div className="model-section-title">
                    <b>体块属性</b>
                    <button
                      aria-label="删除当前体块"
                      onClick={() => requestDelete('feature', [featureId])}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <label className="model-field">
                    用途
                    <select
                      aria-label="体块用途"
                      value={feature.mode}
                      onChange={(e) =>
                        updateFeature(feature.id, {
                          mode: e.target.value,
                          zMM:
                            e.target.value === 'cut' && !feature.attachId
                              ? feature.zMM + feature.heightMM
                              : feature.zMM,
                        })
                      }
                    >
                      <option value="add">凸起 · 增加体积</option>
                      <option value="cut">凹槽 · 切削指定深度</option>
                      <option value="through">贯穿 · 切穿这个零件</option>
                    </select>
                  </label>
                  <label className="model-field">
                    来源面
                    {selectList(feature.regionId, (regionId) =>
                      updateFeature(feature.id, { regionId }),
                    )}
                  </label>
                  <label className="model-field">
                    所属零件
                    <select
                      value={feature.partId}
                      onChange={(e) => {
                        updateFeature(feature.id, {
                          partId: e.target.value,
                          attachId: '',
                        });
                        setPartId(e.target.value);
                      }}
                    >
                      {model.parts.map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {feature.mode !== 'through' && (
                    <>
                      {p.project.creation?.printStack ? (
                        <p className="model-hint">
                          起始位置由部件所属的堆叠层统一计算。调整所属层请返回创作界面。
                        </p>
                      ) : (
                        <>
                          <label className="model-field">
                            高度基准
                            <select
                              aria-label="高度基准"
                              value={feature.attachId || ''}
                              onChange={(e) =>
                                updateFeature(feature.id, {
                                  attachId: e.target.value,
                                })
                              }
                            >
                              <option value="">绝对高度 · Z=0</option>
                              {model.features
                                .filter(
                                  (x: any) =>
                                    x.mode === 'add' &&
                                    x.id !== feature.id &&
                                    x.partId === partId &&
                                    !featureDependants(model, [
                                      feature.id,
                                    ]).includes(x.id),
                                )
                                .map((x: any) => (
                                  <option key={x.id} value={x.id}>
                                    {x.name} · 顶面
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="model-field">
                            {feature.attachId
                              ? '相对顶面偏移'
                              : feature.mode === 'cut'
                                ? '切削起点 Z'
                                : '底面 Z'}
                            （mm）
                            <input
                              key={feature.id + 'z' + feature.zMM}
                              aria-label="体块起始高度"
                              type="number"
                              step={0.1}
                              defaultValue={feature.zMM}
                              onBlur={(e) =>
                                action(() =>
                                  updateFeature(feature.id, {
                                    zMM: +e.target.value,
                                  }),
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                              }}
                            />
                          </label>
                        </>
                      )}
                      <label className="model-field">
                        {feature.mode === 'cut' ? '切削深度' : '厚度'}（
                        {p.project.creation?.printStack ? '打印层' : 'mm'}）
                        {p.project.creation?.printStack ? (
                          <NumberEdit
                            label="体块厚度打印层数"
                            min={1}
                            max={Math.floor(
                              1000 /
                                p.project.creation.printStack.layerHeightMM,
                            )}
                            step={1}
                            value={
                              feature.heightLayers ??
                              printCount(
                                feature.heightMM,
                                p.project.creation.printStack.layerHeightMM,
                              )
                            }
                            onCommit={(heightLayers) =>
                              action(() =>
                                updateFeature(feature.id, { heightLayers }),
                              )
                            }
                          />
                        ) : (
                          <input
                            key={feature.id + 'h' + feature.heightMM}
                            aria-label="体块厚度"
                            type="number"
                            min={0.01}
                            max={1000}
                            step={0.1}
                            defaultValue={feature.heightMM}
                            onBlur={(e) =>
                              action(() =>
                                updateFeature(feature.id, {
                                  heightMM: +e.target.value,
                                }),
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                          />
                        )}
                      </label>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setFeatureId('');
                      setSelected([feature.regionId]);
                      p.onMode('faces');
                    }}
                  >
                    查看来源面
                  </button>
                  <p className="model-help">
                    同一零件的凸起先合并，再执行凹槽与贯穿切削。停用体块会停止其几何作用。
                  </p>
                </>
              ) : selected.length ? (
                <>
                  <div className="model-section-title">
                    <b>
                      {selected.length === 1
                        ? selectedSpec?.name
                        : `已选 ${selected.length} 个面`}
                    </b>
                    <button
                      aria-label="删除所选面"
                      onClick={() => requestDelete('region', selected)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {selectedRegion?.error ? (
                    <p className="model-notice">{selectedRegion.error}</p>
                  ) : (
                    selectedRegion && (
                      <p>
                        {selectedRegion.areaMM2.toFixed(2)} mm² ·{' '}
                        {selectedRegion.components} 块 · {selectedRegion.holes}{' '}
                        孔
                      </p>
                    )
                  )}
                  <button
                    className="primary model-full"
                    disabled={
                      calculating ||
                      selected.some(
                        (id) => regions.find((r) => r.id === id)?.error,
                      ) ||
                      regionRevision.current !== p.project
                    }
                    onClick={() => action(() => addFeatures())}
                  >
                    添加为凸起体块
                  </button>
                  {selected.length === 1 && (
                    <>
                      <p className="model-help">
                        来源：{labels[selectedSpec?.kind]}
                      </p>
                      <button onClick={reselect}>重新指定来源 / 选区</button>
                      {[
                        ...new Set(
                          [
                            selectedSpec?.pathId,
                            ...(selectedSpec?.pathIds || []),
                          ].filter(Boolean),
                        ),
                      ].map((id: string) => (
                        <button
                          className="model-source-link"
                          key={id}
                          onClick={() => p.onEditSource(id)}
                        >
                          编辑源样条：
                          {p.project.paths.find((x) => x.id === id)?.name ||
                            '来源已删除'}
                        </button>
                      ))}
                      <label className="model-field">
                        区域标记色
                        <input
                          type="color"
                          value={selectedSpec?.color || '#b8ef62'}
                          onChange={(e) =>
                            mutate(
                              (m) =>
                                (m.regions.find(
                                  (r: any) => r.id === selectedSpec.id,
                                ).color = e.target.value),
                            )
                          }
                        />
                      </label>
                    </>
                  )}
                </>
              ) : (
                <p className="model-help">
                  点击画布或对象树中的面、体块查看属性。Shift
                  可多选面并批量建立体块。
                </p>
              )}
            </>
          )}
          {tab === 'output' && (
            <>
              <div className="model-section-title">
                <b>当前零件</b>
                <Rename
                  value={
                    model.parts.find((x: any) => x.id === partId)?.name ||
                    '零件'
                  }
                  onChange={(name) =>
                    mutate(
                      (m) =>
                        (m.parts.find((x: any) => x.id === partId).name = name),
                    )
                  }
                />
              </div>
              <label className="model-field">
                底图宽度（mm）<span>{p.project.widthMM} mm</span>
                <small>
                  成品外轮廓尺寸以下方三维计算结果为准；可在描线的工程属性中修改比例。
                </small>
              </label>
              <label className="model-field">
                网格逼近精度（mm）
                <input
                  type="number"
                  min={0.001}
                  max={0.2}
                  step={0.005}
                  key={model.toleranceMM}
                  defaultValue={model.toleranceMM}
                  onBlur={(e) =>
                    action(() =>
                      mutate((m) => (m.toleranceMM = +e.target.value)),
                    )
                  }
                />
              </label>
              <label className="model-check">
                <input
                  type="checkbox"
                  checked={!!model.manufacturingMM}
                  onChange={(e) =>
                    mutate(
                      (m) => (m.manufacturingMM = e.target.checked ? 0.02 : 0),
                    )
                  }
                />
                制造清理 · 0.02 mm
              </label>
              <p className="model-help">
                填合极小缝隙和零宽接触，只改变派生实体。启用后请检查细节。未检测打印机最小壁厚。
              </p>
              {p.mode !== 'relief' && (
                <button onClick={() => p.onMode('relief')}>
                  查看三维并校验
                </button>
              )}
              {result && resultRevision.current === p.project && (
                <div className="model-validation">
                  <b>
                    {result.report.valid && result.report.components === 1
                      ? '闭合实体检查通过'
                      : '需要处理几何问题'}
                  </b>
                  <p>
                    {result.report.sizeMM
                      .map((x: number) => x.toFixed(2))
                      .join(' × ')}{' '}
                    mm
                  </p>
                  <p>
                    {result.report.components} 个连通实体 · 非流形边{' '}
                    {result.report.invalidEdges} · 退化面{' '}
                    {result.report.zeroArea}
                  </p>
                  <p>体积 {(result.report.volumeMM3 / 1000).toFixed(2)} cm³</p>
                  {result.warnings.map((s: string, i: number) => (
                    <p className="model-notice" key={i}>
                      {s}
                    </p>
                  ))}
                </div>
              )}
              <div className="model-export-buttons">
                <button
                  disabled={
                    working ||
                    calculating ||
                    !result?.report.valid ||
                    resultRevision.current !== p.project
                  }
                  onClick={() => action(() => exportModel('3mf'))}
                >
                  <Download size={15} />
                  导出 3MF
                </button>
                <button
                  disabled={working || calculating || !model.features.length}
                  onClick={() => action(() => exportModel('blender'))}
                >
                  Blender 实体 + 源曲线
                </button>
                <button
                  disabled={working || calculating || !model.regions.length}
                  onClick={() => action(() => exportModel('svg'))}
                >
                  导出{selected.length ? '所选' : '全部'}面 SVG
                </button>
              </div>
              <p className="model-help">
                通用 3MF
                保留分色部件、尺寸和位置，不绑定打印机。打印机、耗材与切片参数在切片软件中选择；部分软件需重新指定部件颜色。
              </p>
              <SlicerTemplate
                onExport={() => action(() => exportModel('3mf-bambu'))}
                value={p.project.model?.slicerTemplate}
                onChange={(slicerTemplate) =>
                  p.onModel({ ...p.project.model, slicerTemplate })
                }
                disabled={working}
              />
              <p className="model-help">
                3MF 保留当前零件的分色实体与毫米尺寸，耗材槽在切片软件中指定；面
                SVG 是按上述精度计算的派生轮廓。源贝塞尔 SVG
                在描线工作空间的顶部导出中。
              </p>
            </>
          )}
        </div>
      </aside>
      <Dialog
        open={!!deleteRequest}
        onOpenChange={(open) => {
          if (!open) setDeleteRequest(null);
        }}
      >
        <DialogContent>
          <DialogTitle>删除关联对象？</DialogTitle>
          <DialogDescription>
            这会同时删除 {deleteRequest?.rs.length} 个面与{' '}
            {deleteRequest?.fs.length}{' '}
            个依赖体块。源样条保留，整次删除可以一步撤销。
          </DialogDescription>
          <div className="model-inline">
            <button autoFocus onClick={() => setDeleteRequest(null)}>
              取消
            </button>
            <button onClick={() => erase(deleteRequest.rs, deleteRequest.fs)}>
              删除这些对象
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
