'use client';
import { useState, useRef, useEffect } from 'react';
import {
  PenTool,
  MousePointer2,
  Hand,
  Upload,
  Download,
  Spline,
  Plus,
  Scan,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
  Trash2,
  Check,
  Link,
  Target,
  HelpCircle,
  Save,
  FolderOpen,
  Code2,
  Minus,
  CornerDownLeft,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  type Point,
  type Cubic,
  type Project,
  type TracePath,
  palette,
  download,
  d,
  svg,
  blender,
  validateProject,
  db,
} from '@/lib/project';
// @ts-ignore Shared pure JS geometry module.
import {
  splitCubic,
  evaluate,
  dist,
  inspectGeometry,
} from '../public/geometry.mjs';
// @ts-ignore Shared geometry editor, also tested directly in Node.
import {
  pathNodes,
  nodeSelection,
  selectedNode,
  removeNode,
} from '../public/node-edit.mjs';
const initial: Project = {
  version: 1,
  image: '/reference.png',
  imageName: '角色参考图.png',
  width: 1200,
  height: 1200,
  paths: [],
  widthMM: 100,
  depthMM: 2,
};
type Candidate = Point & { id: string; score: number };
type Settings = {
  mode: 'ink' | 'edge' | 'manual';
  tolerance: number;
  corridor: number;
  snap: boolean;
};
const copy = <T,>(v: T): T => structuredClone(v);
export default function Home() {
  const [project, setProject] = useState<Project>(initial),
    pr = useRef(project);
  const [active, setActive] = useState<string | null>(null),
    ar = useRef(active);
  ar.current = active;
  const [tool, setTool] = useState('trace'),
    [drawing, setDrawing] = useState(false),
    drawingRef = useRef(false);
  drawingRef.current = drawing;
  const [settings, setSettings] = useState<Settings>({
      mode: 'ink',
      tolerance: 1.5,
      corridor: 100,
      snap: true,
    }),
    sr = useRef(settings);
  sr.current = settings;
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    busyRef = useRef(false),
    [status, setStatus] = useState('正在分析底图…');
  const [preview, setPreview] = useState<Cubic[]>([]),
    [proposed, setProposed] = useState<TracePath | null>(null),
    [opacity, setOpacity] = useState(85),
    [vectorsOnly, setVectorsOnly] = useState(false),
    [fill, setFill] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]),
    cr = useRef(candidates);
  cr.current = candidates;
  const allCandidates = useRef<any[]>([]);
  const [showCandidates, setShowCandidates] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, s: 0.5 }),
    vr = useRef(view);
  vr.current = view;
  const stage = useRef<HTMLDivElement>(null),
    worker = useRef<Worker | null>(null),
    scale = useRef(1),
    seq = useRef(0),
    requests = useRef(
      new Map<
        number,
        { resolve: (v: any) => void; reject: (e: Error) => void }
      >(),
    );
  const history = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    [, setHistoryTick] = useState(0),
    [dialog, setDialog] = useState<'export' | 'help' | 'api' | null>(null),
    [saved, setSaved] = useState('本地自动保存'),
    [initialized, setInitialized] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    projectFile = useRef<HTMLInputElement>(null),
    space = useRef(false),
    drag = useRef<any>(null),
    previewToken = useRef(0),
    lastPreview = useRef(0),
    previewBusy = useRef(false),
    [selection, setSelection] = useState<{
      curve: number;
      point: number;
    } | null>(null),
    [coords, setCoords] = useState<Point | null>(null);
  const setDoc = (p: Project, record = true) => {
    if (record) {
      history.current.push(copy(pr.current));
      if (history.current.length > 80) history.current.shift();
      future.current = [];
    }
    pr.current = p;
    setProject(p);
    setHistoryTick((t) => t + 1);
  };
  const transact = (fn: (p: Project) => void) => {
    const p = copy(pr.current);
    fn(p);
    setDoc(p);
  };
  const setActiveNow = (id: string | null) => {
    if (ar.current !== id) setSelection(null);
    ar.current = id;
    setActive(id);
  };
  const fitView = () => {
    if (!stage.current) return;
    const r = stage.current.getBoundingClientRect(),
      p = pr.current,
      s = Math.min((r.width - 80) / p.width, (r.height - 110) / p.height);
    setView({
      s: Math.max(0.05, s),
      x: (r.width - p.width * s) / 2,
      y: (r.height - p.height * s) / 2 - 5,
    });
  };
  const rpc = (args: any) =>
    new Promise<any>((resolve, reject) => {
      if (!worker.current) {
        reject(Error('底图未准备好'));
        return;
      }
      const id = ++seq.current;
      requests.current.set(id, { resolve, reject });
      worker.current.postMessage({ ...args, id });
    });
  useEffect(() => {
    let alive = true;
    db('get')
      .then(async (v) => {
        if (!v) {
          try {
            const r = await fetch('/character-example.bezier.json');
            if (r.ok) v = await r.json();
          } catch {}
        }
        if (v && alive) {
          try {
            setDoc(validateProject(v), false);
            setStatus('已恢复本地工程');
          } catch {
            setStatus('本地工程不可用，已载入参考图');
          }
        }
      })
      .catch(() => setSaved('自动保存不可用，请保存工程'))
      .finally(() => {
        if (alive) setInitialized(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!initialized) return;
    const timer = setTimeout(() => {
      db('put', project)
        .then(() => setSaved('已保存到此浏览器'))
        .catch(() => setSaved('保存失败，请下载工程'));
    }, 700);
    return () => clearTimeout(timer);
  }, [project, initialized]);
  useEffect(() => {
    if (!initialized) return;
    let alive = true;
    setReady(false);
    setPreview([]);
    setCandidates([]);
    setShowCandidates(false);
    const img = new Image();
    img.onload = async () => {
      if (!alive) return;
      try {
        const s = Math.min(1, 900 / img.naturalWidth, 900 / img.naturalHeight);
        scale.current = s;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * s);
        canvas.height = Math.round(img.naturalHeight * s);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        worker.current?.terminate();
        requests.current.forEach((r) => r.reject(Error('底图已更换')));
        requests.current.clear();
        worker.current = new Worker('/trace-worker.js', { type: 'module' });
        worker.current.onmessage = ({ data }) => {
          const req = requests.current.get(data.id);
          if (req) {
            requests.current.delete(data.id);
            data.error ? req.reject(Error(data.error)) : req.resolve(data);
          }
        };
        worker.current.onerror = () => {
          requests.current.forEach((r) =>
            r.reject(Error('图像计算失败，请重新载入')),
          );
          requests.current.clear();
          setBusy(false);
          busyRef.current = false;
          setStatus('图像计算失败，请重新载入');
        };
        const r = await rpc({
          type: 'init',
          rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          w: canvas.width,
          h: canvas.height,
        });
        if (!alive) return;
        allCandidates.current = r.candidates.map((p: any) => ({
          ...p,
          x: p.x / s,
          y: p.y / s,
        }));
        setReady(true);
        setStatus('底图就绪 · 点击轮廓开始描线');
        fitView();
      } catch (e: any) {
        setStatus(e.message);
      }
    };
    img.onerror = () => setStatus('图片读取失败，请重新导入 PNG、JPG 或 WebP');
    img.src = project.image;
    return () => {
      alive = false;
    };
  }, [project.image, initialized]);
  useEffect(() => {
    const observer = new ResizeObserver(() => fitView());
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  const undo = () => {
    if (busyRef.current) return;
    const p = history.current.pop();
    if (!p) return;
    future.current.push(copy(pr.current));
    setDoc(p, false);
    setPreview([]);
    setProposed(null);
    previewToken.current++;
    if (!p.paths.some((x) => x.id === ar.current)) {
      setActiveNow(p.paths.at(-1)?.id || null);
      setDrawing(false);
    }
    setSelection(null);
    setStatus('已撤销');
  };
  const redo = () => {
    if (busyRef.current) return;
    const p = future.current.pop();
    if (!p) return;
    history.current.push(copy(pr.current));
    setDoc(p, false);
    setSelection(null);
    setStatus('已重做');
  };
  const finish = () => {
    setDrawing(false);
    drawingRef.current = false;
    setPreview([]);
    previewToken.current++;
    setStatus('路径已结束 · 可编辑节点，或新建下一条路径');
  };
  const begin = () => {
    finish();
    setActiveNow(null);
    setTool('trace');
    setSelection(null);
    setStatus('点击新的轮廓起点');
  };
  const validPoint = (p: any): Point => {
    if (
      !p ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      p.x < 0 ||
      p.y < 0 ||
      p.x >= pr.current.width ||
      p.y >= pr.current.height
    )
      throw Error('坐标必须在底图范围内，单位为原图像素');
    return { x: p.x, y: p.y };
  };
  const snapped = async (p: Point, config = sr.current) => {
    const s = scale.current;
    if (!config.snap || config.mode === 'manual') return p;
    const r = await rpc({
      type: 'snap',
      point: { x: p.x * s, y: p.y * s },
      mode: config.mode,
      radius: 9 * s,
    });
    return { x: r.point.x / s, y: r.point.y / s };
  };
  const traceSpan = async (
    a: Point,
    b: Point,
    options: Partial<Settings> = {},
    snapEnd = true,
  ) => {
    const cfg = { ...sr.current, ...options },
      s = scale.current;
    if (cfg.mode === 'manual') {
      return {
        end: b,
        curves: [
          [
            a,
            { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
            { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 },
            b,
          ],
        ] as Cubic[],
        quality: 1,
        fitError: 0,
        fitting: 'single',
      };
    }
    const r = await rpc({
      type: 'trace',
      start: { x: a.x * s, y: a.y * s },
      end: { x: b.x * s, y: b.y * s },
      mode: cfg.mode,
      tolerance: cfg.tolerance * s,
      corridor: cfg.corridor * s,
      snap: cfg.snap && snapEnd,
      radius: 9 * s,
    });
    return {
      end: { x: r.end.x / s, y: r.end.y / s },
      curves: r.curves.map((c: any) =>
        c.map((p: any) => ({ x: p.x / s, y: p.y / s })),
      ) as Cubic[],
      quality: r.quality,
      fitError: r.fitError / s,
    };
  };
  const lock = async <T,>(fn: () => Promise<T>) => {
    if (busyRef.current) throw Error('正在拟合，请稍候');
    if (!ready) throw Error('底图尚未准备好');
    busyRef.current = true;
    setBusy(true);
    setPreview([]);
    previewToken.current++;
    try {
      return await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const addAnchor = async (p: Point) =>
    lock(async () => {
      validPoint(p);
      const current = pr.current.paths.find((p) => p.id === ar.current);
      if (!drawingRef.current || !current || current.closed) {
        const start = await snapped(p);
        const path: TracePath = {
          id: crypto.randomUUID(),
          name: `路径 ${pr.current.paths.length + 1}`,
          color: palette[pr.current.paths.length % palette.length],
          start,
          anchors: [start],
          curves: [],
          closed: false,
          visible: true,
          quality: 1,
          fitError: 0,
          fitting: 'single',
        };
        transact((p) => p.paths.push(path));
        setActiveNow(path.id);
        setDrawing(true);
        drawingRef.current = true;
        setStatus('移动查看预览，点击落下下一锚点');
        return start;
      }
      const a = current.curves.at(-1)?.[3] || current.start;
      if (dist(a, p) < 2) return a;
      const r = await traceSpan(a, p);
      transact((p) => {
        const path = p.paths.find((v) => v.id === current.id)!;
        path.curves.push(...r.curves);
        path.anchors.push(r.end);
        path.quality = Math.min(path.quality, r.quality);
        path.fitError = Math.max(path.fitError || 0, r.fitError);
      });
      setStatus(
        r.fitError > sr.current.tolerance
          ? `单段拟合偏差约 ${r.fitError.toFixed(1)} px · 建议撤销并手动补一个锚点`
          : r.quality < 0.35
            ? '边缘较弱，请检查路线；走错时撤销并在分岔前补点'
            : `已连接 1 段贝塞尔 · 未添加中间锚点`,
      );
      return r.end;
    });
  const closePath = async () =>
    lock(async () => {
      const path = pr.current.paths.find((p) => p.id === ar.current);
      if (!path || path.curves.length < 1) throw Error('至少先绘制一段曲线');
      if (path.closed) return;
      const r = await traceSpan(path.curves.at(-1)![3], path.start, {}, false);
      transact((p) => {
        const q = p.paths.find((x) => x.id === path.id)!;
        q.curves.push(...r.curves);
        q.closed = true;
        q.quality = Math.min(q.quality, r.quality);
        q.fitError = Math.max(q.fitError || 0, r.fitError);
      });
      finish();
      setStatus(
        r.fitError > sr.current.tolerance
          ? `已用一段曲线闭合 · 偏差约 ${r.fitError.toFixed(1)} px，建议手动补点`
          : '已用一段曲线闭合 · 未添加中间锚点',
      );
    });
  const report = (promise: Promise<any>) =>
    promise.catch((e: any) => setStatus(e.message));
  const deletePath = () => {
    if (busyRef.current || !ar.current) return;
    transact((p) => (p.paths = p.paths.filter((x) => x.id !== ar.current)));
    setActiveNow(null);
    finish();
    setStatus('已删除路径 · 可撤销');
  };
  const selectNode = (pathId: string, nodeIndex: number) => {
    if (busyRef.current) throw Error('请等待拟合完成');
    const path = pr.current.paths.find((p) => p.id === pathId);
    if (!path) throw Error('路径不存在');
    const selected = nodeSelection(path, nodeIndex);
    finish();
    setActiveNow(pathId);
    setTool('edit');
    setSelection(selected);
    setStatus('已选中节点 ' + (nodeIndex + 1) + ' · Delete 删除 · 拖动调整');
    return { pathId, nodeIndex, position: pathNodes(path)[nodeIndex] };
  };
  const deleteNode = (pathId: string, nodeIndex: number) => {
    if (busyRef.current || drag.current) throw Error('请先完成当前操作');
    const original = pr.current.paths.find((p) => p.id === pathId);
    if (!original) throw Error('路径不存在');
    const result = removeNode(original, nodeIndex, sr.current.tolerance);
    transact((p) => {
      const index = p.paths.findIndex((q) => q.id === pathId);
      if (result.path) p.paths[index] = result.path;
      else p.paths.splice(index, 1);
    });
    finish();
    setActiveNow(result.path ? pathId : null);
    setTool('edit');
    setSelection(null);
    setStatus(
      !result.path
        ? '最后一个节点已删除 · 空路径已移除 · Ctrl+Z 撤销'
        : result.merged
          ? '节点已删除 · 相邻两段合成一段 · 形状变化约 ' +
            result.fitError.toFixed(1) +
            ' px · Ctrl+Z 撤销'
          : '端点已删除 · 其余节点保持不变 · Ctrl+Z 撤销',
    );
    return {
      pathId,
      removedNode: nodeIndex,
      nodes: result.path ? pathNodes(result.path).length : 0,
      segments: result.path?.curves.length || 0,
      merged: result.merged,
      shapeError: result.fitError,
    };
  };
  const deleteSelection = () => {
    const path = pr.current.paths.find((p) => p.id === ar.current);
    const index = selectedNode(path, selection);
    if (tool !== 'edit' || !path || index === null) {
      setStatus(
        '请先在编辑模式点击方形节点，再按 Delete · 圆形控制柄不能单独删除',
      );
      return;
    }
    try {
      deleteNode(path.id, index);
    } catch (e: any) {
      setStatus(e.message);
    }
  };
  const coordinate = (event: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect(),
      v = vr.current;
    return {
      x: (event.clientX - r.left - v.x) / v.s,
      y: (event.clientY - r.top - v.y) / v.s,
    };
  };
  const inside = (p: Point) =>
    p.x >= 0 && p.y >= 0 && p.x < pr.current.width && p.y < pr.current.height;
  const pointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const p = coordinate(e);
    if (tool === 'pan' || space.current || e.button === 1) {
      e.preventDefault();
      drag.current = {
        kind: 'pan',
        x: e.clientX,
        y: e.clientY,
        view: vr.current,
      };
      stage.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'edit') setSelection(null);
    if (tool === 'trace' && ready && !busyRef.current && inside(p))
      report(addAnchor(p));
  };
  const pointerMove = (e: React.PointerEvent) => {
    const p = coordinate(e);
    setCoords(p);
    if (drag.current) {
      const g = drag.current;
      if (g.kind === 'pan') {
        setView({
          ...g.view,
          x: g.view.x + e.clientX - g.x,
          y: g.view.y + e.clientY - g.y,
        });
        return;
      }
      if (!g.moved) {
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 3) return;
        history.current.push(copy(pr.current));
        if (history.current.length > 80) history.current.shift();
        future.current = [];
        g.moved = true;
      }
      const q = copy(pr.current),
        path = q.paths.find((x) => x.id === g.path);
      if (!path) return;
      const c = path.curves[g.curve];
      const target = {
        x: Math.max(0, Math.min(q.width - 1, p.x)),
        y: Math.max(0, Math.min(q.height - 1, p.y)),
      };
      if (!path.curves.length) path.start = target;
      else if (g.point === 1 || g.point === 2) c[g.point] = target;
      else {
        const old = c[g.point],
          delta = { x: target.x - old.x, y: target.y - old.y },
          shift = (v: Point) => ({ x: v.x + delta.x, y: v.y + delta.y });
        c[g.point] = target;
        if (g.point === 0) {
          c[1] = shift(c[1]);
          const prev =
            g.curve > 0
              ? g.curve - 1
              : path.closed
                ? path.curves.length - 1
                : -1;
          if (prev >= 0) {
            path.curves[prev][3] = target;
            path.curves[prev][2] = shift(path.curves[prev][2]);
          }
          if (!g.curve) path.start = target;
        } else {
          c[2] = shift(c[2]);
          const next =
            g.curve + 1 < path.curves.length
              ? g.curve + 1
              : path.closed
                ? 0
                : -1;
          if (next >= 0) {
            path.curves[next][0] = target;
            path.curves[next][1] = shift(path.curves[next][1]);
            if (next === 0) path.start = target;
          }
        }
      }
      if (path.fitting === 'single')
        path.anchors = [path.start, ...path.curves.map((c) => c[3])];
      pr.current = q;
      setProject(q);
      return;
    }
    if (
      tool !== 'trace' ||
      !drawingRef.current ||
      busyRef.current ||
      previewBusy.current ||
      !inside(p) ||
      performance.now() - lastPreview.current < 90
    )
      return;
    const path = pr.current.paths.find((p) => p.id === ar.current);
    if (!path || path.closed) return;
    lastPreview.current = performance.now();
    const token = ++previewToken.current;
    previewBusy.current = true;
    const a = path.curves.at(-1)?.[3] || path.start;
    traceSpan(a, p)
      .then((r) => {
        if (token === previewToken.current && !busyRef.current)
          setPreview(r.curves);
      })
      .catch(() => {})
      .finally(() => {
        previewBusy.current = false;
      });
  };
  const pointerUp = () => {
    if (drag.current?.kind === 'point' && drag.current.moved) {
      setHistoryTick((t) => t + 1);
      setStatus('控制点已调整 · 相邻曲线保持连接');
    }
    drag.current = null;
  };
  const startPointDrag = (
    e: React.PointerEvent,
    curve: number,
    point: number,
  ) => {
    if (space.current || e.button === 1 || tool === 'pan') return;
    e.stopPropagation();
    if (tool !== 'edit' || busyRef.current || e.button !== 0) return;
    e.preventDefault();
    drag.current = {
      kind: 'point',
      path: ar.current,
      curve,
      point,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    setStatus(
      point === 1 || point === 2
        ? '已选中控制柄 · 拖动调整弯曲'
        : '已选中节点 · Delete 删除 · 拖动调整',
    );
    setSelection({ curve, point });
    stage.current?.setPointerCapture(e.pointerId);
  };
  const splitAt = (e: React.MouseEvent, pathId: string) => {
    e.stopPropagation();
    if (tool !== 'edit' || busyRef.current) return;
    const p = coordinate(e),
      path = pr.current.paths.find((x) => x.id === pathId)!;
    let best = { distance: Infinity, i: 0, t: 0.5 };
    path.curves.forEach((c, i) => {
      for (let j = 1; j < 100; j++) {
        const t = j / 100,
          distance = dist(p, evaluate(c, t));
        if (distance < best.distance) best = { distance, i, t };
      }
    });
    transact((q) => {
      const a = q.paths.find((x) => x.id === pathId)!;
      a.curves.splice(
        best.i,
        1,
        ...(splitCubic(a.curves[best.i], best.t) as Cubic[]),
      );
      if (a.fitting === 'single')
        a.anchors = [a.start, ...a.curves.map((c) => c[3])];
    });
    setSelection({ curve: best.i, point: 3 });
    setStatus('已精确拆分曲线，形状保持不变');
  };
  const zoom = (factor: number, center?: Point) => {
    const r = stage.current!.getBoundingClientRect(),
      c = center || { x: r.width / 2, y: r.height / 2 };
    setView((v) => {
      const s = Math.min(12, Math.max(0.05, v.s * factor));
      return {
        s,
        x: c.x - ((c.x - v.x) * s) / v.s,
        y: c.y - ((c.y - v.y) * s) / v.s,
      };
    });
  };
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.0015), {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,[role="slider"],[contenteditable="true"]',
        ) ||
        dialog
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        space.current = true;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportFile('json');
      } else if (e.key === 'Enter') {
        finish();
      } else if (e.key === 'Escape') {
        finish();
        setProposed(null);
        setSelection(null);
      } else if (e.key.toLowerCase() === 'p') setTool('trace');
      else if (e.key.toLowerCase() === 'v') {
        finish();
        setTool('edit');
      } else if (e.key.toLowerCase() === 'h') setTool('pan');
      else if (e.key.toLowerCase() === 'c') report(closePath());
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    const blur = () => {
      space.current = false;
      drag.current = null;
    };
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  });
  const importImage = async (f: File) => {
    if (busyRef.current) throw Error('请等待当前拟合完成');
    if (!/^image\/(png|jpeg|webp)$/.test(f.type))
      throw Error('请导入 PNG、JPG 或 WebP 图片');
    if (f.size > 30 * 1024 * 1024) throw Error('图片不能超过 30 MB');
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(Error('文件读取失败'));
      r.readAsDataURL(f);
    });
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(Error('图片损坏'));
      img.src = data;
    });
    let src = data,
      w = img.naturalWidth,
      h = img.naturalHeight;
    if (w > 4096 || h > 4096) {
      const s = Math.min(4096 / w, 4096 / h);
      w = Math.round(w * s);
      h = Math.round(h * s);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      src = c.toDataURL('image/png');
    }
    finish();
    setActiveNow(null);
    setDoc({ ...initial, image: src, imageName: f.name, width: w, height: h });
    setStatus('正在分析新底图…');
  };
  const exportFile = (format: 'svg' | 'blender' | 'json') => {
    const p = pr.current;
    if (format === 'json') {
      download(
        JSON.stringify(p, null, 2),
        '描迹工程.bezier.json',
        'application/json',
      );
      setStatus('工程已下载，包含底图和所有曲线');
      return;
    }
    if (!p.paths.some((p) => p.visible && p.curves.length)) {
      setStatus('请先绘制至少一段曲线');
      return;
    }
    download(
      format === 'svg' ? svg(p) : blender(p),
      format === 'svg' ? '角色轮廓.svg' : '角色曲线_blender.py',
      format === 'svg' ? 'image/svg+xml' : 'text/x-python',
    );
    setStatus(
      format === 'svg'
        ? 'SVG 已导出，保留三次贝塞尔和毫米尺寸'
        : 'Blender 脚本已导出 · 在脚本工作区打开并运行',
    );
  };
  const detect = (args: any = {}) => {
    if (!ready) throw Error('底图尚未准备好');
    if (
      args.limit !== undefined &&
      (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 120)
    )
      throw Error('limit 必须为 1–120 的整数');
    if (
      args.spacing !== undefined &&
      (!Number.isFinite(args.spacing) || args.spacing < 8 || args.spacing > 500)
    )
      throw Error('spacing 必须为 8–500 像素');
    const limit = args.limit || 48,
      spacing = args.spacing || 30,
      r = args.region || {
        x: 0,
        y: 0,
        width: pr.current.width,
        height: pr.current.height,
      };
    if (
      ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
      r.width <= 0 ||
      r.height <= 0
    )
      throw Error('候选区域无效');
    const out: Candidate[] = [];
    for (const p of allCandidates.current) {
      if (p.x < r.x || p.y < r.y || p.x > r.x + r.width || p.y > r.y + r.height)
        continue;
      if (out.every((q) => dist(p, q) > spacing))
        out.push({ ...p, id: `C${String(out.length + 1).padStart(2, '0')}` });
      if (out.length >= limit) break;
    }
    cr.current = out;
    setCandidates(out);
    setShowCandidates(true);
    setStatus(`已标记 ${out.length} 个候选点 · 点击编号开始或继续路径`);
    return out;
  };
  const createPath = async (args: any) =>
    lock(async () => {
      if (
        !Array.isArray(args.points) ||
        args.points.length < 2 ||
        args.points.length > 200
      )
        throw Error('points 需要 2–200 个坐标或候选点编号');
      const pts: Point[] = args.points.map((p: any) =>
        typeof p === 'string'
          ? validPoint(cr.current.find((c) => c.id === p))
          : validPoint(p),
      );
      if (args.mode && !['ink', 'edge', 'manual'].includes(args.mode))
        throw Error('mode 必须是 ink、edge 或 manual');
      const config = {
        ...sr.current,
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.tolerance ? { tolerance: args.tolerance } : {}),
        ...(args.corridor ? { corridor: args.corridor } : {}),
        ...(typeof args.snap === 'boolean' ? { snap: args.snap } : {}),
      };
      if (
        !Number.isFinite(config.tolerance) ||
        config.tolerance < 0.3 ||
        config.tolerance > 12 ||
        !Number.isFinite(config.corridor) ||
        config.corridor < 10 ||
        config.corridor > 400
      )
        throw Error('拟合参数超出范围');
      let a = await snapped(pts[0], config);
      const path: TracePath = {
        id: crypto.randomUUID(),
        name: String(args.name || `路径 ${pr.current.paths.length + 1}`).slice(
          0,
          120,
        ),
        color: palette[pr.current.paths.length % palette.length],
        start: a,
        anchors: [a],
        curves: [],
        closed: !!args.closed,
        visible: true,
        quality: 1,
        fitError: 0,
        fitting: 'single',
      };
      const targets = path.closed ? [...pts.slice(1), a] : pts.slice(1);
      for (let i = 0; i < targets.length; i++) {
        if (dist(a, targets[i]) < 0.1) continue;
        const r = await traceSpan(
          a,
          targets[i],
          config,
          !(path.closed && i === targets.length - 1),
        );
        path.curves.push(...r.curves);
        path.anchors.push(r.end);
        path.quality = Math.min(path.quality, r.quality);
        path.fitError = Math.max(path.fitError || 0, r.fitError);
        a = r.end;
      }
      if (!path.curves.length) throw Error('锚点不能全部重合');
      if (args.preview) {
        setProposed(path);
        setStatus(
          `候选路径已生成 · ${path.curves.length} 段曲线` +
            ((path.fitError || 0) > config.tolerance
              ? ` · 偏差约 ${path.fitError!.toFixed(1)} px，建议手动补点`
              : '，检查后接受'),
        );
      } else {
        transact((p) => p.paths.push(path));
        setActiveNow(path.id);
        finish();
        setStatus(
          `已创建「${path.name}」· ${path.curves.length} 段曲线` +
            ((path.fitError || 0) > config.tolerance
              ? ` · 偏差约 ${path.fitError!.toFixed(1)} px，建议手动补点`
              : ''),
        );
      }
      return {
        id: path.id,
        name: path.name,
        segments: path.curves.length,
        quality: path.quality,
        fitError: path.fitError,
        needsAnchor: (path.fitError || 0) > config.tolerance,
        closed: path.closed,
        preview: !!args.preview,
      };
    });
  const refitPath = async (args: { id?: string } = {}) =>
    lock(async () => {
      const original = pr.current.paths.find(
        (p) => p.id === (args.id || ar.current),
      );
      if (!original) throw Error('请先选中路径');
      const points = original.anchors.filter(
        (p, i, all) => !i || dist(p, all[i - 1]) > 0.1,
      );
      if (
        original.closed &&
        points.length > 1 &&
        dist(points[0], points.at(-1)) < 0.1
      )
        points.pop();
      if (points.length < 2) throw Error('这条旧路径没有足够的原落点记录');
      const path = copy(original);
      path.curves = [];
      path.quality = 1;
      path.fitError = 0;
      path.fitting = 'single';
      path.start = points[0];
      path.anchors = [points[0]];
      const targets = original.closed
        ? [...points.slice(1), points[0]]
        : points.slice(1);
      let a = points[0];
      for (const b of targets) {
        const r = await traceSpan(a, b, {}, false);
        path.curves.push(...r.curves);
        path.anchors.push(b);
        path.quality = Math.min(path.quality, r.quality);
        path.fitError = Math.max(path.fitError, r.fitError);
        a = b;
      }
      transact((p) => {
        p.paths[p.paths.findIndex((q) => q.id === original.id)] = path;
      });
      finish();
      setTool('edit');
      setActiveNow(path.id);
      setSelection(null);
      setStatus(
        '已按原落点重拟合：' +
          points.length +
          ' 个锚点、' +
          path.curves.length +
          ' 段曲线 · 可撤销',
      );
      return {
        id: path.id,
        anchors: points.length,
        segments: path.curves.length,
        fitError: path.fitError,
      };
    });
  const acceptPreview = () => {
    if (!proposed) throw Error('没有候选路径');
    setStatus('候选路径已接受');
    transact((p) => p.paths.push(proposed));
    setActiveNow(proposed.id);
    setProposed(null);
    return { id: proposed.id };
  };
  const apiRef = useRef<any>(null);
  apiRef.current = {
    state: () => ({
      ready,
      busy: busyRef.current,
      image: {
        name: pr.current.imageName,
        width: pr.current.width,
        height: pr.current.height,
      },
      widthMM: pr.current.widthMM,
      depthMM: pr.current.depthMM,
      active: ar.current,
      selection: selection
        ? {
            ...selection,
            nodeIndex: selectedNode(
              pr.current.paths.find((p) => p.id === ar.current),
              selection,
            ),
          }
        : null,
      settings: sr.current,
      paths: pr.current.paths.map(
        ({
          id,
          name,
          curves,
          closed,
          visible,
          quality,
          anchors,
          fitting,
          fitError,
        }) => ({
          id,
          name,
          segments: curves.length,
          closed,
          visible,
          quality,
          fitting,
          fitError,
          anchors,
        }),
      ),
      candidates: cr.current,
    }),
    detect_candidates: detect,
    create_path: createPath,
    refit_path: refitPath,
    select_node: (a: any) => selectNode(a.pathId, a.nodeIndex),
    delete_node: (a: any) => deleteNode(a.pathId, a.nodeIndex),
    commit_preview: acceptPreview,
    discard_preview: () => {
      setProposed(null);
      return { discarded: true };
    },
    get_project: () => copy(pr.current),
    inspect_geometry: () => inspectGeometry(pr.current.paths),
    undo: () => {
      undo();
      return { paths: pr.current.paths.length };
    },
    set_view: (a: any) => {
      if (a.fit) {
        fitView();
        return { fit: true };
      }
      if (
        ![a.x, a.y, a.scale].every(Number.isFinite) ||
        a.scale < 0.05 ||
        a.scale > 12
      )
        throw Error('view 需要 x、y 和 0.05–12 的 scale');
      setView({ x: a.x, y: a.y, s: a.scale });
      return a;
    },
    select_path: (a: any) => {
      if (!pr.current.paths.some((p) => p.id === a.id))
        throw Error('路径不存在');
      setActiveNow(a.id);
      finish();
      setTool('edit');
      return { id: a.id };
    },
    set_point: (a: any) => {
      const path = pr.current.paths.find((p) => p.id === a.pathId);
      if (
        !path ||
        !Number.isInteger(a.curve) ||
        !path.curves[a.curve] ||
        ![1, 2].includes(a.point)
      )
        throw Error('set_point 支持现有曲线的控制柄 1 或 2');
      const point = validPoint(a.position);
      transact((p) => {
        p.paths.find((q) => q.id === a.pathId)!.curves[a.curve][a.point] =
          point;
      });
      return { updated: true };
    },
    export: (a: any) => {
      if (a.format === 'svg')
        return { filename: '角色轮廓.svg', content: svg(pr.current) };
      if (a.format === 'blender')
        return {
          filename: '角色曲线_blender.py',
          content: blender(pr.current),
        };
      if (a.format === 'json')
        return {
          filename: '描迹工程.bezier.json',
          content: JSON.stringify(pr.current),
        };
      throw Error('format 必须是 svg、blender 或 json');
    },
    load_project: (a: any) => {
      if (busyRef.current) throw Error('请等待拟合完成');
      const p = validateProject(a.project);
      finish();
      setActiveNow(null);
      setDoc(p);
      return { paths: p.paths.length };
    },
    set_candidates_visible: (a: any) => {
      setShowCandidates(!!a.visible);
      return { visible: !!a.visible };
    },
  };
  useEffect(() => {
    (window as any).traceStudio = {
      version: '1.2',
      call: async (action: string, args: any = {}) => {
        const fn = apiRef.current[action];
        if (!fn) throw Error('未知操作 ' + action);
        return await fn(args);
      },
    };
    const context = (document as any).modelContext,
      controller = new AbortController();
    const names = [
      'state',
      'detect_candidates',
      'create_path',
      'commit_preview',
      'refit_path',
      'select_node',
      'delete_node',
      'get_project',
      'set_point',
      'inspect_geometry',
      'export',
    ];
    const properties: any = {
      state: {},
      detect_candidates: {
        limit: { type: 'number' },
        spacing: { type: 'number' },
        region: { type: 'object' },
      },
      create_path: {
        points: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: { x: { type: 'number' }, y: { type: 'number' } },
                required: ['x', 'y'],
              },
            ],
          },
        },
        name: { type: 'string' },
        closed: { type: 'boolean' },
        preview: { type: 'boolean' },
        mode: { enum: ['ink', 'edge', 'manual'] },
        tolerance: { type: 'number' },
        corridor: { type: 'number' },
      },
      commit_preview: {},
      refit_path: { id: { type: 'string' } },
      select_node: {
        pathId: { type: 'string' },
        nodeIndex: { type: 'integer' },
      },
      delete_node: {
        pathId: { type: 'string' },
        nodeIndex: { type: 'integer' },
      },
      get_project: {},
      inspect_geometry: {},
      set_point: {
        pathId: { type: 'string' },
        curve: { type: 'integer' },
        point: { enum: [1, 2] },
        position: { type: 'object' },
      },
      export: { format: { enum: ['svg', 'blender', 'json'] } },
    };
    for (const name of names)
      try {
        void Promise.resolve(
          context?.registerTool(
            {
              name: 'bezier_' + name,
              description: (
                {
                  state: 'Read image dimensions, paths and fit quality.',
                  detect_candidates:
                    'Generate numbered image corner candidates and display on canvas. Original image pixel coordinates.',
                  create_path:
                    'Trace ordered coordinates or candidate IDs along image edges and fit exactly one cubic per adjacent pair, without inserting intermediate anchors. fitError reports when the user should add a point. preview=true stages for visual review.',
                  refit_path:
                    'Refit an existing path using its recorded user anchors, exactly one cubic per pair. Undoable; does not insert extra anchors.',
                  select_node:
                    'Select a unique anchor by zero-based nodeIndex. Closed seam counts once. Highlight on canvas.',
                  delete_node:
                    'Delete one anchor by zero-based nodeIndex. Merge affected spans into exactly one cubic, preserve other spans. Undoable. Last node removes empty path.',
                  commit_preview: 'Commit the staged path to the project.',
                  inspect_geometry:
                    'Check visible paths for connection gaps and sampled self-intersections; return locations. This is a 2D check, not a manifold mesh guarantee.',
                  get_project:
                    'Read complete image and editable Bezier geometry.',
                  set_point:
                    'Edit a cubic control handle by path, curve index, and handle index.',
                  export:
                    'Return SVG, Blender Python, or project JSON without downloading.',
                } as any
              )[name],
              inputSchema: {
                type: 'object',
                properties: properties[name],
                required:
                  name === 'create_path'
                    ? ['points']
                    : ['select_node', 'delete_node'].includes(name)
                      ? ['pathId', 'nodeIndex']
                      : name === 'set_point'
                        ? ['pathId', 'curve', 'point', 'position']
                        : name === 'export'
                          ? ['format']
                          : [],
                additionalProperties: false,
              },
              annotations: {
                readOnlyHint: [
                  'state',
                  'get_project',
                  'inspect_geometry',
                  'export',
                ].includes(name),
                untrustedContentHint: true,
              },
              execute: (args: any) =>
                (window as any).traceStudio.call(name, args),
            },
            { signal: controller.signal },
          ),
        ).catch(() => {});
      } catch {}
    // Optional loopback companion, development only. Hosted app never connects.
    let stopped = false;
    let timer: any;
    const tick = async () => {
      if (stopped) return;
      try {
        const r = await fetch('http://127.0.0.1:4318/next', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiRef.current.state()),
        });
        if (r.ok) {
          const commands: any = await r.json();
          for (const c of commands) {
            let result;
            try {
              result = {
                id: c.id,
                result: await (window as any).traceStudio.call(
                  c.action,
                  c.args,
                ),
              };
            } catch (e: any) {
              result = { id: c.id, error: e.message };
            }
            await fetch('http://127.0.0.1:4318/result', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result),
            });
          }
        }
      } catch {}
      timer = setTimeout(tick, 700);
    };
    if (location.hostname === 'localhost' && location.port === '3000') tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      delete (window as any).traceStudio;
    };
  }, []);
  const geometryReport =
    dialog === 'export' ? inspectGeometry(project.paths) : [];
  const current = project.paths.find((p) => p.id === active),
    count = project.paths.reduce((s, p) => s + p.curves.length, 0);
  return (
    <main
      className="studio"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0])
          report(importImage(e.dataTransfer.files[0]));
      }}
    >
      <header>
        <div className="brand">
          <Spline />
          <b>描迹</b>
          <span>BÉZIER STUDIO</span>
        </div>
        <span className="project-name">
          角色轮廓研究 <i>{saved}</i>
        </span>
        <div className="header-actions">
          <button
            title="保存完整工程 Ctrl S"
            onClick={() => exportFile('json')}
          >
            <Save size={16} />
            <span className="wide-label">保存工程</span>
          </button>
          <button onClick={() => file.current?.click()} disabled={busy}>
            <Upload size={16} />
            导入底图
          </button>
          <button className="primary" onClick={() => setDialog('export')}>
            <Download size={16} />
            导出
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) report(importImage(f));
            e.target.value = '';
          }}
        />
        <input
          ref={projectFile}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f)
              report(
                f
                  .text()
                  .then((t) =>
                    apiRef.current.load_project({ project: JSON.parse(t) }),
                  ),
              );
            e.target.value = '';
          }}
        />
      </header>
      <div className="workspace">
        <nav className="toolrail" aria-label="绘图工具">
          {[
            [PenTool, 'trace', '描线', 'P'],
            [MousePointer2, 'edit', '编辑', 'V'],
            [Hand, 'pan', '平移', 'H'],
          ].map(([Icon, value, label, key]: any) => (
            <button
              key={value}
              title={`${label} (${key})`}
              aria-label={`${label} (${key})`}
              className={tool === value ? 'selected' : ''}
              onClick={() => {
                setTool(value);
                if (value !== 'trace') finish();
              }}
            >
              <Icon size={20} />
              <small>{label}</small>
            </button>
          ))}
          <hr />
          <button
            title="撤销 Ctrl Z"
            aria-label="撤销"
            onClick={undo}
            disabled={!history.current.length || busy}
          >
            <Undo2 size={19} />
          </button>
          <button
            title="重做 Ctrl Shift Z"
            aria-label="重做"
            onClick={redo}
            disabled={!future.current.length || busy}
          >
            <Redo2 size={19} />
          </button>
          <hr />
          <button
            title="标记候选拐点"
            aria-label="标记候选拐点"
            className={showCandidates ? 'selected' : ''}
            onClick={() => {
              if (showCandidates) setShowCandidates(false);
              else
                try {
                  detect();
                } catch (e: any) {
                  setStatus(e.message);
                }
            }}
            disabled={!ready}
          >
            <Target size={20} />
            <small>候选点</small>
          </button>
          <div className="rail-bottom">
            <button
              title="打开工程"
              aria-label="打开工程"
              onClick={() => projectFile.current?.click()}
            >
              <FolderOpen size={19} />
            </button>
            <button
              title="Agent API"
              aria-label="Agent API"
              onClick={() => setDialog('api')}
            >
              <Code2 size={19} />
            </button>
            <button
              title="操作帮助"
              aria-label="操作帮助"
              onClick={() => setDialog('help')}
            >
              <HelpCircle size={19} />
            </button>
          </div>
        </nav>
        <section
          ref={stage}
          className={`stage tool-${tool}`}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          onPointerLeave={() => {
            if (!drag.current) {
              setPreview([]);
              previewToken.current++;
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            finish();
          }}
        >
          <div className="stage-top">
            <span>
              <span className="live-dot" />
              {busy
                ? '正在拟合…'
                : tool === 'trace'
                  ? '智能描线'
                  : tool === 'edit'
                    ? '节点与控制柄'
                    : '平移画布'}
            </span>
            <span>
              {project.imageName} · {project.width} × {project.height}
            </span>
          </div>
          <svg
            className="drawing-canvas"
            aria-label="贝塞尔绘图画布"
            width="100%"
            height="100%"
          >
            <g transform={`translate(${view.x},${view.y}) scale(${view.s})`}>
              <rect
                x="0"
                y="0"
                width={project.width}
                height={project.height}
                fill={vectorsOnly ? '#20272c' : '#050606'}
                stroke="#4c565d"
                strokeWidth={1 / view.s}
              />
              {!vectorsOnly && (
                <image
                  href={project.image}
                  width={project.width}
                  height={project.height}
                  opacity={opacity / 100}
                />
              )}
              {project.paths
                .filter((p) => p.visible)
                .map((path) => (
                  <g key={path.id}>
                    <path
                      d={d(path.curves) + (path.closed ? ' Z' : '')}
                      fill={fill && path.closed ? path.color + '24' : 'none'}
                      stroke={path.color}
                      strokeWidth={(path.id === active ? 2.2 : 1.65) / view.s}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      aria-label={path.name}
                      d={d(path.curves) + (path.closed ? ' Z' : '')}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14 / view.s}
                      style={{
                        pointerEvents: tool === 'edit' ? 'stroke' : 'none',
                      }}
                      onPointerDown={(e) => {
                        if (
                          tool === 'edit' &&
                          !space.current &&
                          e.button === 0
                        ) {
                          e.stopPropagation();
                          setActiveNow(path.id);
                          setSelection(null);
                        }
                      }}
                      onDoubleClick={(e) => splitAt(e, path.id)}
                    />
                  </g>
                ))}
              {current?.visible && (
                <g>
                  {tool === 'edit' ? (
                    <>
                      {' '}
                      {current.curves.map((c, i) => (
                        <g key={i}>
                          {[1, 2]
                            .filter((k) => {
                              const node = selectedNode(current, selection);
                              return node !== null
                                ? (k === 1
                                    ? i
                                    : current.closed
                                      ? (i + 1) % current.curves.length
                                      : i + 1) === node
                                : selection?.curve === i;
                            })
                            .map((k) => (
                              <g
                                key={k}
                                data-control-handle={i + ':' + k}
                                onPointerDown={(e) => startPointDrag(e, i, k)}
                                style={{ cursor: 'grab' }}
                              >
                                <line
                                  x1={c[k === 1 ? 0 : 3].x}
                                  y1={c[k === 1 ? 0 : 3].y}
                                  x2={c[k].x}
                                  y2={c[k].y}
                                  stroke={current.color}
                                  opacity=".6"
                                  strokeWidth={1 / view.s}
                                />
                                <circle
                                  cx={c[k].x}
                                  cy={c[k].y}
                                  r={9 / view.s}
                                  fill="transparent"
                                />
                                <circle
                                  cx={c[k].x}
                                  cy={c[k].y}
                                  r={4 / view.s}
                                  stroke={current.color}
                                  strokeWidth={1 / view.s}
                                  fill={
                                    selection?.curve === i &&
                                    selection.point === k
                                      ? current.color
                                      : '#20272c'
                                  }
                                  pointerEvents="none"
                                />
                              </g>
                            ))}
                        </g>
                      ))}
                      {pathNodes(current).map((p: Point, index: number) => {
                        const selected =
                          selectedNode(current, selection) === index;
                        const item = nodeSelection(current, index);
                        return (
                          <g
                            key={'node-' + index}
                            role="button"
                            aria-label={'节点 ' + (index + 1)}
                            aria-pressed={selected}
                            data-node-index={index}
                            onPointerDown={(e) =>
                              startPointDrag(e, item.curve, item.point)
                            }
                            style={{ cursor: 'move' }}
                          >
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={11 / view.s}
                              fill="transparent"
                            />
                            {selected && (
                              <circle
                                cx={p.x}
                                cy={p.y}
                                r={9 / view.s}
                                fill="#ffbe5530"
                                stroke="#ffbe55"
                                strokeWidth={1 / view.s}
                                pointerEvents="none"
                              />
                            )}
                            <rect
                              x={p.x - (selected ? 5 : 4) / view.s}
                              y={p.y - (selected ? 5 : 4) / view.s}
                              width={(selected ? 10 : 8) / view.s}
                              height={(selected ? 10 : 8) / view.s}
                              fill={selected ? '#ffbe55' : current.color}
                              stroke={selected ? '#fff5db' : '#102015'}
                              strokeWidth={1.5 / view.s}
                              pointerEvents="none"
                            />
                          </g>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      {current.anchors.map((p, i) => (
                        <circle
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r={i === 0 ? 5 / view.s : 3 / view.s}
                          fill={i === 0 ? '#1b2a16' : current.color}
                          stroke={current.color}
                          strokeWidth={2 / view.s}
                          onPointerDown={(e) => {
                            if (i === 0 && drawing && current.curves.length) {
                              e.stopPropagation();
                              report(closePath());
                            }
                          }}
                        />
                      ))}
                    </>
                  )}
                </g>
              )}
              {preview.length > 0 && (
                <path
                  d={d(preview)}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={2 / view.s}
                  strokeDasharray={`${6 / view.s} ${4 / view.s}`}
                  pointerEvents="none"
                />
              )}
              {proposed && (
                <path
                  d={d(proposed.curves)}
                  fill="none"
                  stroke="#ffb763"
                  strokeWidth={2.5 / view.s}
                  strokeDasharray={`${7 / view.s} ${3 / view.s}`}
                  pointerEvents="none"
                />
              )}
              {showCandidates &&
                candidates.map((c) => (
                  <g
                    key={c.id}
                    transform={`translate(${c.x},${c.y}) scale(${1 / view.s})`}
                    className="candidate"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (ready && !busy) report(addAnchor(c));
                    }}
                  >
                    <circle
                      r="4"
                      fill="#18272c"
                      stroke="#66d9ef"
                      strokeWidth="1.5"
                    />
                    <rect
                      x="5"
                      y="-20"
                      width="30"
                      height="16"
                      rx="3"
                      fill="#15323be8"
                      stroke="#66d9ef88"
                    />
                    <text
                      x="20"
                      y="-8"
                      textAnchor="middle"
                      fill="#9be9f7"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {c.id}
                    </text>
                  </g>
                ))}
            </g>
          </svg>
          <div className="canvas-hint">
            <PenTool size={16} />
            <span>
              {!ready
                ? '正在准备图像…'
                : drawing
                  ? '移动预览，点击固定；走错时撤销并补点'
                  : tool === 'edit'
                    ? '点选方点 · Delete 删除 · 拖动调整 · 双击曲线加点'
                    : '点击轮廓起点，再点击下一个位置'}
            </span>
            {drawing && (
              <>
                <kbd>Enter</kbd>
                <span>结束路径</span>
              </>
            )}
          </div>
          <div
            className="view-controls"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button title="适合画布" aria-label="适合画布" onClick={fitView}>
              <Scan size={16} />
            </button>
            <button
              title="缩小"
              aria-label="缩小"
              onClick={() => zoom(1 / 1.25)}
            >
              <Minus size={14} />
            </button>
            <span>{Math.round(view.s * 100)}%</span>
            <button title="放大" aria-label="放大" onClick={() => zoom(1.25)}>
              <Plus size={14} />
            </button>
          </div>
          {proposed && (
            <div
              className="preview-actions"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span>
                候选路径 · {proposed.curves.length} 段
                {(proposed.fitError || 0) > settings.tolerance
                  ? ' · 建议手动补点'
                  : ''}
              </span>
              <button className="primary" onClick={acceptPreview}>
                <Check size={15} />
                接受
              </button>
              <button onClick={() => setProposed(null)}>丢弃</button>
            </div>
          )}
        </section>
        <aside className="inspector">
          <section>
            <div className="eyebrow">TRACE SETTINGS</div>
            <h2>让曲线跟随轮廓</h2>
            <p>
              每两个落点仅生成一段贝塞尔。算法只调整两个控制柄，不自动增加中间锚点。
            </p>
            <label>识别目标</label>
            <Tabs
              value={settings.mode}
              onValueChange={(v) => {
                setSettings((s) => ({ ...s, mode: v as Settings['mode'] }));
                setPreview([]);
              }}
            >
              <TabsList className="mode-tabs">
                <TabsTrigger value="ink">深色线条</TabsTrigger>
                <TabsTrigger value="edge">颜色边缘</TabsTrigger>
                <TabsTrigger value="manual">手动</TabsTrigger>
              </TabsList>
            </Tabs>
            <label>
              补点提示阈值 <span>{settings.tolerance.toFixed(1)} px</span>
            </label>
            <Slider
              aria-label="补点提示阈值"
              min={0.5}
              max={6}
              step={0.5}
              value={[settings.tolerance]}
              onValueChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  tolerance: Array.isArray(v) ? v[0] : v,
                }))
              }
            />
            <p className="note">超过此偏差时提示手动补点；不会自动分段。</p>
            <label>
              搜索范围 <span>{settings.corridor} px</span>
            </label>
            <Slider
              aria-label="搜索范围"
              min={20}
              max={250}
              step={10}
              value={[settings.corridor]}
              onValueChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  corridor: Array.isArray(v) ? v[0] : v,
                }))
              }
            />
            <label className="switch-label">
              锚点吸附{' '}
              <Switch
                aria-label="锚点吸附"
                checked={settings.snap}
                onCheckedChange={(v) => setSettings((s) => ({ ...s, snap: v }))}
              />
            </label>
            <div className="path-actions">
              <button disabled={!drawing || busy} onClick={finish}>
                <Check size={15} />
                结束
              </button>
              <button
                disabled={!current?.curves.length || current.closed || busy}
                onClick={() => report(closePath())}
              >
                <Link size={15} />
                闭合
              </button>
            </div>
          </section>
          <section className="paths-section">
            <div className="section-title">
              <h3>
                曲线路径 <span className="counter">{project.paths.length}</span>
              </h3>
              <button
                aria-label="新建路径"
                title="新建路径"
                onClick={begin}
                disabled={busy}
              >
                <Plus size={16} />
              </button>
            </div>
            {!project.paths.length ? (
              <div className="empty-path">
                <Spline size={25} />
                <p>从一个锚点开始</p>
                <small>每条路径可独立编辑和导出</small>
              </div>
            ) : (
              <div className="path-list">
                {project.paths.map((path) => (
                  <div
                    key={path.id}
                    className={`path-row ${path.id === active ? 'active' : ''}`}
                  >
                    <button
                      className="path-select"
                      onClick={() => {
                        setActiveNow(path.id);
                        finish();
                        setSelection(null);
                      }}
                    >
                      <span
                        className="path-swatch"
                        style={{ background: path.color }}
                      />
                      <span>
                        {path.name}
                        <small>
                          {path.closed ? '闭合' : '开放'} · {path.curves.length}{' '}
                          段{path.quality < 0.35 ? ' · 待检查' : ''}
                        </small>
                      </span>
                    </button>
                    <button
                      aria-label={`切换可见性 ${path.name}`}
                      title="切换可见性"
                      onClick={() =>
                        transact((p) => {
                          const q = p.paths.find((x) => x.id === path.id)!;
                          q.visible = !q.visible;
                        })
                      }
                    >
                      {path.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {current && (
              <>
                {tool === 'edit' && (
                  <div className="node-inspector">
                    <div>
                      <strong>
                        {selectedNode(current, selection) !== null
                          ? '节点 ' +
                            (selectedNode(current, selection) + 1) +
                            ' / ' +
                            pathNodes(current).length
                          : selection
                            ? '控制柄'
                            : '节点编辑'}
                      </strong>
                      <span>{pathNodes(current).length} 个节点</span>
                    </div>
                    <p>
                      {selectedNode(current, selection) !== null
                        ? (() => {
                            const p =
                              pathNodes(current)[
                                selectedNode(current, selection)
                              ];
                            return (
                              'X ' +
                              p.x.toFixed(1) +
                              ' · Y ' +
                              p.y.toFixed(1) +
                              ' px'
                            );
                          })()
                        : selection
                          ? '拖动圆形手柄调整弯曲。删除请选方点。'
                          : '点击方点选中，显示相邻控制柄；拖动可调整位置。'}
                    </p>
                    <button
                      disabled={
                        busy || selectedNode(current, selection) === null
                      }
                      onClick={deleteSelection}
                    >
                      <Trash2 size={14} />
                      删除节点 <kbd>Del</kbd>
                    </button>
                    <small>中间节点删除后合为一段 · Ctrl+Z 撤销</small>
                  </div>
                )}

                <button
                  className="example-button"
                  disabled={busy || !ready || current.anchors.length < 2}
                  onClick={() => report(refitPath())}
                >
                  按原落点重拟合
                </button>
                <input
                  className="path-name-input"
                  aria-label="路径名称"
                  value={current.name}
                  onChange={(e) =>
                    transact((p) => {
                      p.paths.find((x) => x.id === active)!.name =
                        e.target.value;
                    })
                  }
                />
                <div className="path-actions">
                  <button
                    onClick={() => {
                      finish();
                      setTool('edit');
                    }}
                  >
                    <MousePointer2 size={14} />
                    编辑
                  </button>
                  <button
                    disabled={current.closed}
                    onClick={() => {
                      setTool('trace');
                      setDrawing(true);
                      drawingRef.current = true;
                    }}
                  >
                    <CornerDownLeft size={14} />
                    续画
                  </button>
                  <button
                    aria-label="删除当前路径"
                    onClick={deletePath}
                    disabled={busy}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </>
            )}
          </section>
          <section>
            <h3>底图与预览</h3>
            <label>
              底图不透明度 <span>{opacity}%</span>
            </label>
            <Slider
              aria-label="底图不透明度"
              min={0}
              max={100}
              value={[opacity]}
              onValueChange={(v) => setOpacity(Array.isArray(v) ? v[0] : v)}
            />
            <label className="switch-label">
              仅看曲线{' '}
              <Switch
                aria-label="仅看曲线"
                checked={vectorsOnly}
                onCheckedChange={setVectorsOnly}
              />
            </label>
            <label className="switch-label">
              闭合区域填充{' '}
              <Switch
                aria-label="闭合区域填充"
                checked={fill}
                onCheckedChange={setFill}
              />
            </label>
          </section>
          <section className="workflow">
            <b>为建模准备干净的曲线</b>
            <p>
              闭合外轮廓 → 设置毫米尺寸 → 导入 Blender →
              检查后挤出。二维描线不会自动恢复立体角色。
            </p>
            <button
              className="example-button"
              disabled={busy}
              onClick={() =>
                report(
                  fetch('/character-example.bezier.json')
                    .then((r) => {
                      if (!r.ok) throw Error('示例读取失败');
                      return r.json();
                    })
                    .then((p) => apiRef.current.load_project({ project: p })),
                )
              }
            >
              <FolderOpen size={15} />
              载入角色描线示例
            </button>
            <p>44 条路径 · 可编辑、可撤销载入</p>
          </section>
        </aside>
      </div>
      <footer>
        <span role="status">
          <span className="live-dot" />
          {status}
        </span>
        <span>
          {count} 段
          {coords && inside(coords)
            ? ` · X ${Math.round(coords.x)} Y ${Math.round(coords.y)}`
            : ''}{' '}
          · 滚轮缩放 · 空格平移
        </span>
      </footer>
      <Dialog
        open={dialog !== null}
        onOpenChange={(v) => {
          if (!v) setDialog(null);
        }}
      >
        <DialogContent className="studio-dialog">
          <DialogTitle>
            {dialog === 'export'
              ? '导出到下一步'
              : dialog === 'api'
                ? 'Agent API · 视觉与几何协作'
                : '描线操作指南'}
          </DialogTitle>
          <DialogDescription>
            {dialog === 'export'
              ? '导出所有可见路径。底图不会写入 SVG 或 Blender 脚本。'
              : dialog === 'api'
                ? '所有点均使用原图像素坐标。编号候选点与画布中的标记一致。'
                : '先明确路线，再让算法计算贝塞尔控制点。'}
          </DialogDescription>
          {dialog === 'export' ? (
            <>
              <div className="dimension-fields">
                <label>
                  整张底图宽度
                  <input
                    type="number"
                    aria-label="底图毫米宽度"
                    min="1"
                    max="10000"
                    value={project.widthMM}
                    onChange={(e) => {
                      const v = +e.target.value;
                      if (v > 0 && v <= 10000) transact((p) => (p.widthMM = v));
                    }}
                  />
                  <span>mm</span>
                </label>
                <label>
                  Blender 挤出总厚度
                  <input
                    type="number"
                    aria-label="挤出厚度"
                    min="0"
                    max="1000"
                    step=".5"
                    value={project.depthMM}
                    onChange={(e) => {
                      const v = +e.target.value;
                      if (v >= 0 && v <= 1000) transact((p) => (p.depthMM = v));
                    }}
                  />
                  <span>mm</span>
                </label>
              </div>
              <div className="export-option">
                <div>
                  <b>SVG 矢量曲线</b>
                  <p>原生三次贝塞尔 · 毫米比例 · 无底图</p>
                </div>
                <button
                  className="primary"
                  onClick={() => exportFile('svg')}
                  disabled={!count}
                >
                  导出 SVG
                </button>
              </div>
              <div className="export-option">
                <div>
                  <b>Blender 导入脚本</b>
                  <p>
                    保留控制柄；闭合路径填充并挤出。打开 Scripting 工作区运行
                    .py。
                  </p>
                </div>
                <button onClick={() => exportFile('blender')} disabled={!count}>
                  导出 .py
                </button>
              </div>
              <div className="export-option">
                <div>
                  <b>可继续编辑的完整工程</b>
                  <p>底图、路径、尺寸与控制点 · JSON</p>
                </div>
                <button onClick={() => exportFile('json')}>保存工程</button>
              </div>
              <p className="export-note">
                抽样几何检查：
                {geometryReport.reduce(
                  (n: number, p: any) => n + p.gaps,
                  0,
                )}{' '}
                处缺口，
                {geometryReport.reduce(
                  (n: number, p: any) => n + p.selfIntersections.length,
                  0,
                )}{' '}
                处自交。
                {geometryReport
                  .filter((p: any) => p.selfIntersections.length)
                  .map((p: any) => p.name)
                  .join('、')}
                <br />
                当前{' '}
                {
                  project.paths.filter((p) => p.visible && p.curves.length)
                    .length
                }{' '}
                条可见路径，其中{' '}
                {project.paths.filter((p) => p.visible && p.closed).length}{' '}
                条闭合。重叠区域需要在 Blender
                中整理；打印前应检查闭合体和最小壁厚。
              </p>
            </>
          ) : dialog === 'api' ? (
            <>
              <pre>{`await window.traceStudio.call('detect_candidates', {\n  region: {x: 300, y: 250, width: 500, height: 400},\n  limit: 35, spacing: 25\n});\nawait window.traceStudio.call('create_path', {\n  name: '刘海', points: ['C03', 'C12', {x: 610, y: 565}],\n  mode: 'ink', preview: true\n});\nawait window.traceStudio.call('commit_preview');`}</pre>
              <p>
                可用操作：state、detect_candidates、create_path、commit_preview、discard_preview、get_project、select_path、select_node、delete_node、refit_path、set_point、set_view、undo、inspect_geometry、export、load_project。
              </p>
              <p>
                支持 WebMCP 的浏览器会注册 bezier_ 前缀工具。本地配套 HTTP
                服务可连接同一工作台，供 Agent 批量调用与读回验证。
              </p>
              <button
                onClick={() => {
                  detect();
                  setDialog(null);
                }}
                disabled={!ready}
              >
                <Target size={16} />
                生成并显示候选点
              </button>
            </>
          ) : (
            <div className="help-content">
              <p>
                <b>1. 点击起点</b>
                　选“深色线条”跟随描边；选“颜色边缘”跟随色块交界。底图可拖入。
              </p>
              <p>
                <b>2. 看预览再落点</b>
                　白色虚线是下一段预览。分岔或尖角之前增加锚点；路线走错用 Ctrl
                Z 撤销，缩短间距重试。
              </p>
              <p>
                <b>3. 结束或闭合</b>　Enter / 右键结束；点击起点或按 C
                闭合。新路径用右侧 ＋。选中开放路径可续画。
              </p>
              <p>
                <b>4. 精修控制点</b>　V 切换编辑。点击方点选中，Delete /
                Backspace
                删除单个节点；拖动方点移动，圆点调整控制柄。双击曲线插入节点，Esc
                取消选中。所有修改可用 Ctrl+Z 撤销。
              </p>
              <p>
                <b>5. 保存与导出</b>　工程在当前浏览器自动保存；Ctrl S
                下载完整工程。导出 SVG 或 Blender 脚本时按整张底图设置毫米尺寸。
              </p>
              <p>
                <kbd>P</kbd> 描线　<kbd>V</kbd> 编辑　<kbd>H</kbd> 平移　
                <kbd>Space</kbd> 拖动　滚轮缩放
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
