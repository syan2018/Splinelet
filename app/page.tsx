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
// @ts-ignore Shared connection operations.
import {
  connectionSettings,
  straightCubic,
  mergeSplines,
} from '../public/connect.mjs';
// @ts-ignore Browser persistence and serialized file writes.
import { workspaceDB, FileWriter } from '../public/persistence.mjs';
// @ts-ignore Shared node continuity constraints.
import {
  nodeModes,
  nodeSides,
  setContinuity,
  moveHandle,
  enforceContinuity,
} from '../public/continuity.mjs';
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
    [saved, setSaved] = useState('正在恢复工程…'),
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
  const [modifiers, setModifiers] = useState({
    shiftKey: false,
    altKey: false,
  });
  const modifierRef = useRef(modifiers);
  const lastPointer = useRef<Point | null>(null);
  const [mergeSource, setMergeSource] = useState<{
    pathId: string;
    end: 'start' | 'end';
  } | null>(null);
  const updateModifiers = (e: { shiftKey: boolean; altKey: boolean }) => {
    const old = modifierRef.current;
    if (old.shiftKey !== e.shiftKey || old.altKey !== e.altKey) {
      const next = { shiftKey: e.shiftKey, altKey: e.altKey };
      modifierRef.current = next;
      setModifiers(next);
    }
  };
  const [pendingRefit, setPendingRefit] = useState<{
    id: string;
    name: string;
    segments: number;
    snapshot: Project;
  } | null>(null);
  const [propertyTab, setPropertyTab] = useState('paths');
  const [inspectorWidth, setInspectorWidth] = useState(320);
  const sidebarDrag = useRef<{ x: number; width: number } | null>(null);
  const draggedPath = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [renamingPath, setRenamingPath] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const clampInspector = (width: number) =>
    Math.max(240, Math.min(600, window.innerWidth - 280, width));
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem('bezier-inspector-width'));
      if (w >= 240) setInspectorWidth(clampInspector(w));
    } catch {}
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('bezier-inspector-width', String(inspectorWidth));
      } catch {}
    }, 250);
    return () => clearTimeout(timer);
  }, [inspectorWidth]);
  useEffect(() => {
    const resize = () => setInspectorWidth((w) => clampInspector(w));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const fileHandle = useRef<any>(null);
  const allowAutoWrite = useRef(false);
  const writer = useRef(new FileWriter());
  const backupQueue = useRef(Promise.resolve());
  const backupSaved = useRef<Project | null>(null);
  const backupBinding = useRef<any>(null);
  const fileSaved = useRef<{ handle: any; project: Project } | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const fileBusyRef = useRef(false);
  const [bindingVersion, setBindingVersion] = useState(0);
  const bindFile = (handle: any) => {
    fileHandle.current = handle;
    allowAutoWrite.current = false;
    fileSaved.current = null;
    setFileName(handle?.name || '');
    setBindingVersion((v) => v + 1);
  };
  const backupProject = (snapshot: Project, handle = fileHandle.current) => {
    const task = backupQueue.current
      .catch(() => {})
      .then(() => workspaceDB('put', { project: snapshot, handle }));
    backupQueue.current = task;
    return task.then(() => {
      backupSaved.current = snapshot;
      backupBinding.current = handle;
    });
  };
  const writeProjectFile = async (snapshot: Project, handle: any) => {
    await writer.current.write(handle, JSON.stringify(snapshot, null, 2));
    fileSaved.current = { handle, project: snapshot };
    if (pr.current === snapshot && fileHandle.current === handle)
      setSaved('已保存到 ' + handle.name);
  };
  const saveProject = async (saveAs = false) => {
    if (fileBusyRef.current) return;
    fileBusyRef.current = true;
    setFileBusy(true);
    try {
      let handle = saveAs ? null : fileHandle.current;
      if (!handle) {
        if (!(window as any).showSaveFilePicker) {
          await backupProject(pr.current);
          setSaved('已保存到此浏览器 · 当前浏览器不支持直接写文件');
          setStatus(
            '工程已更新到同一份浏览器备份；可在导出面板下载副本，或用 Chrome / Edge 绑定文件',
          );
          return;
        }
        handle = await (window as any).showSaveFilePicker({
          suggestedName: fileName || '描迹工程.bezier.json',
          types: [
            {
              description: '描迹工程',
              accept: { 'application/json': ['.json'] },
            },
          ],
        });
      } else if (
        (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
      ) {
        if (
          (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted'
        )
          throw Error('未获得文件写入权限；请重新保存授权或另存为');
      }
      const snapshot = pr.current;
      setSaved('正在写入工程文件…');
      await writeProjectFile(snapshot, handle);
      if (fileHandle.current !== handle) bindFile(handle);
      allowAutoWrite.current = true;
      fileSaved.current = { handle, project: snapshot };
      await backupProject(pr.current, handle);
      setSaved(
        pr.current === snapshot
          ? '已保存到 ' + handle.name
          : '有新修改 · 等待自动保存',
      );
      setStatus(
        '已绑定 ' + handle.name + ' · 后续修改自动写回，Ctrl+S 立即保存',
      );
      navigator.storage?.persist?.().catch(() => {});
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setStatus('已取消选择保存位置');
        return;
      }
      setSaved('文件保存失败 · ' + e.message);
      setStatus('文件未写入成功；浏览器备份仍独立保存。可重试保存或另存为。');
    } finally {
      fileBusyRef.current = false;
      setFileBusy(false);
    }
  };
  const openProjectFile = async () => {
    if (busyRef.current || fileBusyRef.current) return;
    if (!(window as any).showOpenFilePicker) {
      projectFile.current?.click();
      return;
    }
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: '描迹工程',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const file = await handle.getFile();
      const parsed = validateProject(JSON.parse(await file.text()));
      apiRef.current.load_project({ project: parsed });
      bindFile(handle);
      allowAutoWrite.current = true;
      fileSaved.current = { handle, project: pr.current };
      await backupProject(pr.current, handle);
      setSaved('已打开 ' + handle.name + ' · 修改后自动保存');
      setStatus('已打开原文件 · Ctrl+S 保存到同一文件，首次写入可能需要授权');
    } catch (e: any) {
      if (e.name !== 'AbortError') setStatus('打开工程失败：' + e.message);
    }
  };
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
    if (ar.current !== id) {
      setSelection(null);
      setMergeSource(null);
    }
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
    workspaceDB('get')
      .then(async (session: any) => {
        let v = session?.project;
        if (!v) {
          try {
            const r = await fetch('/character-example.bezier.json');
            if (r.ok) v = await r.json();
          } catch {}
        }
        if (v && alive) {
          try {
            setDoc(validateProject(v), false);
            if (session?.handle) {
              bindFile(session.handle);
              fileSaved.current = null;
            }
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
    const handle = fileHandle.current;
    setSaved(
      handle
        ? fileSaved.current?.handle === handle &&
          fileSaved.current?.project === project
          ? '已保存到 ' + handle.name
          : '有修改 · 等待写入 ' + handle.name
        : '正在保存浏览器备份…',
    );
    const backupTimer = setTimeout(() => {
      backupProject(project, handle)
        .then(() => {
          if (pr.current === project && !fileHandle.current)
            setSaved('已保存到此浏览器 · 可绑定工程文件');
        })
        .catch((e: any) => {
          setSaved('浏览器备份失败');
          setStatus('浏览器备份失败：' + e.message + '；请保存到工程文件');
        });
    }, 200);
    const fileTimer = setTimeout(async () => {
      if (
        !handle ||
        (fileSaved.current?.handle === handle &&
          fileSaved.current?.project === project)
      )
        return;
      try {
        if (!allowAutoWrite.current) {
          setSaved('浏览器备份已恢复 · 点击保存重新连接 ' + handle.name);
          return;
        }
        if (
          (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
        ) {
          if (fileHandle.current === handle)
            setSaved('文件尚未写入 · 点击保存以授权 ' + handle.name);
          return;
        }
        if (fileHandle.current !== handle || pr.current !== project) return;
        setSaved('正在保存 ' + handle.name + '…');
        await writeProjectFile(project, handle);
      } catch (e: any) {
        if (fileHandle.current === handle)
          setSaved('文件自动保存失败 · 点击保存重试');
      }
    }, 800);
    return () => {
      clearTimeout(backupTimer);
      clearTimeout(fileTimer);
    };
  }, [project, initialized, bindingVersion]);
  useEffect(() => {
    const flush = () => {
      if (
        initialized &&
        (backupSaved.current !== pr.current ||
          backupBinding.current !== fileHandle.current)
      )
        backupProject(pr.current).catch(() => {});
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (
        initialized &&
        (backupSaved.current !== pr.current ||
          backupBinding.current !== fileHandle.current ||
          (fileHandle.current &&
            (fileSaved.current?.handle !== fileHandle.current ||
              fileSaved.current?.project !== pr.current)))
      ) {
        flush();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', leave);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', leave);
    };
  }, [initialized]);
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
    setMergeSource(null);
    setStatus('已撤销');
  };
  const redo = () => {
    if (busyRef.current) return;
    const p = future.current.pop();
    if (!p) return;
    history.current.push(copy(pr.current));
    setDoc(p, false);
    setSelection(null);
    setMergeSource(null);
    setStatus('已重做');
  };
  const finish = () => {
    setMergeSource(null);
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
    setPropertyTab('trace');
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
        curves: [straightCubic(a, b)] as Cubic[],
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
  const addAnchor = async (p: Point, options: Partial<Settings> = {}) =>
    lock(async () => {
      validPoint(p);
      const config = { ...sr.current, ...options };
      const current = pr.current.paths.find((p) => p.id === ar.current);
      if (!drawingRef.current || !current || current.closed) {
        const start = await snapped(p, config);
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
      const r = await traceSpan(a, p, config);
      transact((p) => {
        const path = p.paths.find((v) => v.id === current.id)!;
        path.curves.push(...r.curves);
        path.anchors.push(r.end);
        if (path.nodeModes) path.nodeModes.push('corner');
        path.quality = Math.min(path.quality, r.quality);
        path.fitError = Math.max(path.fitError || 0, r.fitError);
      });
      setStatus(
        config.mode === 'manual'
          ? '已直连 · 未吸附、未拟合 · 可拖动控制柄调整'
          : r.fitError > sr.current.tolerance
            ? `单段拟合偏差约 ${r.fitError.toFixed(1)} px · 按 L 改为直连，或撤销补点`
            : r.quality < 0.35
              ? '边缘较弱，请检查路线 · L 改为直连，或撤销补点'
              : `已连接 1 段贝塞尔 · 未添加中间锚点`,
      );
      return r.end;
    });
  const closePath = async (options: Partial<Settings> = {}) =>
    lock(async () => {
      const path = pr.current.paths.find((p) => p.id === ar.current);
      if (!path || path.curves.length < 1) throw Error('至少先绘制一段曲线');
      if (path.closed) return;
      const r = await traceSpan(
        path.curves.at(-1)![3],
        path.start,
        options,
        false,
      );
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
    setPropertyTab('node');
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
  const straightenSpan = (pathId: string, curve?: number) => {
    if (busyRef.current || drag.current) throw Error('请先完成当前操作');
    const path = pr.current.paths.find((p) => p.id === pathId);
    const index =
      curve ??
      (tool === 'edit' && ar.current === pathId && selection
        ? selection.curve
        : (path?.curves.length || 0) - 1);
    if (!path || !Number.isInteger(index) || !path.curves[index])
      throw Error('请先绘制一段曲线，或选中要调整的节点/控制柄');
    transact((p) => {
      const q = p.paths.find((p) => p.id === pathId)!;
      const c = q.curves[index];
      q.curves[index] = straightCubic(c[0], c[3]) as Cubic;
      q.nodeModes = nodeModes(q);
      q.nodeModes![index] = 'corner';
      q.nodeModes![q.closed ? (index + 1) % q.curves.length : index + 1] =
        'corner';
      delete q.fitError;
    });
    setPreview([]);
    previewToken.current++;
    setStatus('第 ' + (index + 1) + ' 段已改为直连 · 端点不动 · Ctrl+Z 撤销');
    return { pathId, curve: index };
  };
  const startMerge = () => {
    const path = pr.current.paths.find((p) => p.id === ar.current);
    const node = selectedNode(path, selection);
    if (
      !path ||
      path.closed ||
      !path.curves.length ||
      node === null ||
      ![0, path.curves.length].includes(node)
    ) {
      setStatus('请在编辑模式选中开放样条的起点或终点，再按 M 合并');
      return;
    }
    if (
      !pr.current.paths.some(
        (p) => p.id !== path.id && p.visible && !p.closed && p.curves.length,
      )
    ) {
      setStatus('需要另一条可见的开放样条才能合并');
      return;
    }
    setMergeSource({ pathId: path.id, end: node === 0 ? 'start' : 'end' });
    setStatus('点击另一条样条的蓝色端点完成合并 · Esc 取消');
  };
  const mergePaths = (args: {
    firstId: string;
    firstEnd: 'start' | 'end';
    secondId: string;
    secondEnd: 'start' | 'end';
  }) => {
    if (busyRef.current || drag.current) throw Error('请先完成当前操作');
    const a = pr.current.paths.find((p) => p.id === args.firstId),
      b = pr.current.paths.find((p) => p.id === args.secondId);
    const result = mergeSplines(a, args.firstEnd, b, args.secondEnd);
    transact((p) => {
      p.paths = p.paths
        .filter((p) => p.id !== args.secondId)
        .map((p) => (p.id === args.firstId ? result.path : p));
    });
    finish();
    setTool('edit');
    setActiveNow(result.path.id);
    setSelection(nodeSelection(result.path, result.joinNode));
    setStatus(
      result.bridge
        ? '两条样条已合并 · 端点之间补一段直连，无额外节点 · Ctrl+Z 撤销'
        : '重合端点已接合 · 原曲线保持不变 · Ctrl+Z 撤销',
    );
    return {
      id: result.path.id,
      removedId: args.secondId,
      segments: result.path.curves.length,
      bridge: result.bridge,
    };
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
    updateModifiers(e);
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
    if (tool === 'edit') {
      setSelection(null);
      setActiveNow(null);
      setMergeSource(null);
      setStatus('已取消选择');
    }
    if (tool === 'trace' && ready && !busyRef.current && inside(p))
      report(addAnchor(p, connectionSettings(sr.current, e)));
  };
  const pointerMove = (e: React.PointerEvent) => {
    const p = coordinate(e);
    setCoords(p);
    lastPointer.current = p;
    updateModifiers(e);
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
      else if (g.point === 1 || g.point === 2)
        moveHandle(path, g.curve, g.point, target);
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
    traceSpan(a, p, connectionSettings(sr.current, e))
      .then((r) => {
        if (token === previewToken.current && !busyRef.current)
          setPreview(r.curves);
      })
      .catch(() => {})
      .finally(() => {
        previewBusy.current = false;
      });
  };
  useEffect(() => {
    const p = lastPointer.current,
      path = pr.current.paths.find((p) => p.id === ar.current);
    const token = ++previewToken.current;
    setPreview([]);
    if (
      !p ||
      !ready ||
      tool !== 'trace' ||
      !drawingRef.current ||
      busyRef.current ||
      !path ||
      path.closed ||
      !inside(p)
    )
      return;
    traceSpan(
      path.curves.at(-1)?.[3] || path.start,
      p,
      connectionSettings(sr.current, modifiers),
    )
      .then((r) => {
        if (previewToken.current === token && !busyRef.current)
          setPreview(r.curves);
      })
      .catch(() => {});
  }, [modifiers.shiftKey, modifiers.altKey]);
  useEffect(() => {
    if (tool !== 'edit') setMergeSource(null);
  }, [tool]);
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
    setPropertyTab('node');
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
      const modes = nodeModes(a);
      if (modes[best.i] === 'symmetric') modes[best.i] = 'smooth';
      const nextNode = a.closed ? (best.i + 1) % a.curves.length : best.i + 1;
      if (modes[nextNode] === 'symmetric') modes[nextNode] = 'smooth';
      modes.splice(best.i + 1, 0, 'smooth');
      a.curves.splice(
        best.i,
        1,
        ...(splitCubic(a.curves[best.i], best.t) as Cubic[]),
      );
      a.nodeModes = modes;
      enforceContinuity(a);
      if (a.fitting === 'single')
        a.anchors = [a.start, ...a.curves.map((c) => c[3])];
    });
    setSelection({ curve: best.i, point: 3 });
    setStatus('已精确拆分，形状保持不变；受影响的对称节点改为平滑连接');
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
      updateModifiers(e);
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,[role="slider"],[contenteditable="true"]',
        ) ||
        dialog ||
        pendingRefit
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
        void saveProject(e.shiftKey);
      } else if (e.key === 'Enter') {
        finish();
      } else if (e.key === 'Escape') {
        finish();
        setProposed(null);
        setSelection(null);
        if (!mergeSource) setActiveNow(null);
        setStatus(mergeSource ? '已取消合并' : '已取消选择');
      } else if (e.key.toLowerCase() === 'p') setTool('trace');
      else if (e.key.toLowerCase() === 'v') {
        finish();
        setTool('edit');
      } else if (e.key.toLowerCase() === 'h') setTool('pan');
      else if (e.key.toLowerCase() === 'c')
        report(closePath(connectionSettings(sr.current, e)));
      else if (
        e.key.toLowerCase() === 'm' &&
        tool === 'edit' &&
        !e.ctrlKey &&
        !e.metaKey
      )
        startMerge();
      else if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        try {
          straightenSpan(ar.current || '');
        } catch (e: any) {
          setStatus(e.message);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      }
    };
    const up = (e: KeyboardEvent) => {
      updateModifiers(e);
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    const blur = () => {
      space.current = false;
      updateModifiers({ shiftKey: false, altKey: false });
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
    if (busyRef.current || fileBusyRef.current)
      throw Error('请等待当前拟合或保存完成');
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
    bindFile(null);
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
  const requestRefit = (args: { id?: string } = {}) => {
    const p = pr.current.paths.find((p) => p.id === (args.id || ar.current));
    if (!p) throw Error('请先选择路径');
    setPendingRefit({
      id: p.id,
      name: p.name,
      segments: p.curves.length,
      snapshot: pr.current,
    });
    return { pendingConfirmation: true, id: p.id, segments: p.curves.length };
  };
  const changeNodeMode = (args: {
    pathId: string;
    nodeIndex: number;
    mode: string;
  }) => {
    if (busyRef.current || drag.current) throw Error('请先完成当前操作');
    const original = pr.current.paths.find((p) => p.id === args.pathId);
    if (!original) throw Error('路径不存在');
    const changed = copy(original);
    setContinuity(changed, args.nodeIndex, args.mode);
    delete changed.fitError;
    transact((p) => {
      p.paths[p.paths.findIndex((p) => p.id === args.pathId)] = changed;
    });
    setStatus(
      args.mode === 'corner'
        ? '节点已设为尖角 · 控制柄独立'
        : args.mode === 'smooth'
          ? '节点已设为平滑 · 两侧手柄共线联动'
          : '节点已设为对称连续 · 两侧手柄共线且等长',
    );
    return { pathId: args.pathId, nodeIndex: args.nodeIndex, mode: args.mode };
  };
  const movePath = (a: {
    pathId: string;
    groupId?: string;
    beforeId?: string;
  }) => {
    if (busyRef.current) throw Error('请等待拟合完成');
    const original = pr.current.paths.find((p) => p.id === a.pathId);
    if (!original) throw Error('路径不存在');
    const before = a.beforeId
      ? pr.current.paths.find((p) => p.id === a.beforeId)
      : null;
    if (a.beforeId && !before) throw Error('目标路径不存在');
    const groupId = before ? before.groupId || '' : a.groupId || '';
    if (groupId && !pr.current.groups?.some((g) => g.id === groupId))
      throw Error('目标分组不存在');
    if (a.pathId === a.beforeId) return { moved: false };
    transact((p) => {
      const index = p.paths.findIndex((p) => p.id === a.pathId);
      const [path] = p.paths.splice(index, 1);
      if (groupId) path.groupId = groupId;
      else delete path.groupId;
      let target = before
        ? p.paths.findIndex((p) => p.id === before.id)
        : p.paths.reduce(
            (last, p, i) => ((p.groupId || '') === groupId ? i + 1 : last),
            p.paths.length,
          );
      p.paths.splice(target, 0, path);
    });
    setStatus('路径已移动 · 拖到行前可排序 · Ctrl+Z 撤销');
    return { moved: true, pathId: a.pathId, groupId };
  };
  const dropPath = (e: React.DragEvent, groupId: string, beforeId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const id =
      e.dataTransfer.getData('application/x-bezier-path') ||
      draggedPath.current;
    setDropTarget(null);
    draggedPath.current = null;
    if (!id) return;
    try {
      movePath({ pathId: id, groupId, beforeId });
    } catch (e: any) {
      setStatus(e.message);
    }
  };
  const finishPathRename = () => {
    if (!renamingPath) return;
    const { id, name } = renamingPath;
    setRenamingPath(null);
    const trimmed = name.trim();
    if (!trimmed || pr.current.paths.find((p) => p.id === id)?.name === trimmed)
      return;
    transact((p) => {
      const path = p.paths.find((p) => p.id === id);
      if (path) path.name = trimmed;
    });
  };
  const finishGroupRename = () => {
    if (!renamingGroup) return;
    const next = renamingGroup;
    setRenamingGroup(null);
    if (next.name.trim())
      manageGroup({ action: 'rename', id: next.id, name: next.name.trim() });
  };
  const manageGroup = (a: any) => {
    if (busyRef.current) throw Error('请等待当前拟合完成');
    const action = a.action,
      groups = pr.current.groups || [];
    if (
      !['create', 'rename', 'assign', 'visibility', 'delete'].includes(action)
    )
      throw Error('无效分组操作');
    if (
      ['rename', 'delete', 'visibility'].includes(action) &&
      !groups.some((g) => g.id === a.id)
    )
      throw Error('分组不存在');
    if (action === 'assign' && a.id && !groups.some((g) => g.id === a.id))
      throw Error('分组不存在');
    if (
      ['create', 'rename'].includes(action) &&
      (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80)
    )
      throw Error('分组名称需要 1–80 个字符');
    if (
      action === 'assign' &&
      (!Array.isArray(a.pathIds) ||
        !a.pathIds.length ||
        a.pathIds.some(
          (id: string) => !pr.current.paths.some((p) => p.id === id),
        ))
    )
      throw Error('请选择存在的路径');
    if (action === 'visibility' && typeof a.visible !== 'boolean')
      throw Error('visible 必须为布尔值');
    const id = action === 'create' ? crypto.randomUUID() : a.id;
    transact((p) => {
      p.groups = p.groups || [];
      if (action === 'create') p.groups.push({ id, name: a.name.trim() });
      if (action === 'rename')
        p.groups.find((g) => g.id === id)!.name = a.name.trim();
      if (action === 'assign')
        p.paths
          .filter((p) => a.pathIds.includes(p.id))
          .forEach((p) => {
            if (id) p.groupId = id;
            else delete p.groupId;
          });
      if (action === 'visibility')
        p.paths
          .filter((p) => p.groupId === id)
          .forEach((p) => (p.visible = a.visible));
      if (action === 'delete') {
        p.groups = p.groups.filter((g) => g.id !== id);
        p.paths
          .filter((p) => p.groupId === id)
          .forEach((p) => delete p.groupId);
      }
    });
    setStatus(
      action === 'delete'
        ? '已解散分组，曲线已移至未分组 · 可撤销'
        : '分组已更新 · 自动保存 · 可撤销',
    );
    return { id, action };
  };
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
      delete path.nodeModes;
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
      storage: {
        fileName: fileHandle.current?.name || null,
        status: saved,
        fileSystemSupported:
          typeof window !== 'undefined' && !!(window as any).showSaveFilePicker,
      },
      active: ar.current,
      modifiers: modifierRef.current,
      mergeSource,
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
          groupId,
          nodeModes,
        }) => ({
          id,
          name,
          groupId,
          nodeModes,
          segments: curves.length,
          closed,
          visible,
          quality,
          fitting,
          fitError,
          anchors,
        }),
      ),
      groups: pr.current.groups || [],
      candidates: cr.current,
    }),
    detect_candidates: detect,
    create_path: createPath,
    refit_path: requestRefit,
    set_node_mode: changeNodeMode,
    manage_group: manageGroup,
    move_path: movePath,
    merge_paths: mergePaths,
    straighten_span: (a: any) => straightenSpan(a.pathId, a.curve),
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
      if (busyRef.current || drag.current) throw Error('请先完成当前操作');
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
        moveHandle(
          p.paths.find((q) => q.id === a.pathId)!,
          a.curve,
          a.point,
          point,
        );
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
      if (busyRef.current || fileBusyRef.current)
        throw Error('请等待拟合或保存完成');
      const p = validateProject(a.project);
      bindFile(null);
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
      version: '1.5',
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
      'set_node_mode',
      'manage_group',
      'move_path',
      'merge_paths',
      'straighten_span',
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
        snap: { type: 'boolean' },
      },
      commit_preview: {},
      refit_path: { id: { type: 'string' } },
      set_node_mode: {
        pathId: { type: 'string' },
        nodeIndex: { type: 'integer' },
        mode: { enum: ['corner', 'smooth', 'symmetric'] },
      },
      move_path: {
        pathId: { type: 'string' },
        groupId: { type: 'string' },
        beforeId: { type: 'string' },
      },
      manage_group: {
        action: {
          enum: ['create', 'rename', 'assign', 'visibility', 'delete'],
        },
        id: { type: 'string' },
        name: { type: 'string' },
        pathIds: { type: 'array', items: { type: 'string' } },
        visible: { type: 'boolean' },
      },
      merge_paths: {
        firstId: { type: 'string' },
        firstEnd: { enum: ['start', 'end'] },
        secondId: { type: 'string' },
        secondEnd: { enum: ['start', 'end'] },
      },
      straighten_span: {
        pathId: { type: 'string' },
        curve: { type: 'integer' },
      },
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
                    'Request a refit confirmation dialog. No geometry changes until the user explicitly confirms in the UI. Refitting replaces manual handle edits and continuity modes.',
                  set_node_mode:
                    'Set corner, smooth (collinear), or symmetric (equal opposite handles, C1) for one internal node. Undoable.',
                  move_path:
                    'Move a path into a group, or before another path (also adopting its group). Undoable.',
                  manage_group:
                    'Create, rename, assign paths, toggle group visibility, or dissolve a group without deleting paths. Undoable.',
                  merge_paths:
                    'Join two distinct open splines at chosen endpoints. Preserve curve shapes by reversing directions when needed; insert one straight cubic only when endpoints differ. Undoable; keep first path ID.',
                  straighten_span:
                    'Replace one existing cubic with a straight cubic at the same endpoints; keep all anchors. curve defaults to selection or last span. Undoable.',
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
                  name === 'move_path'
                    ? ['pathId']
                    : name === 'set_node_mode'
                      ? ['pathId', 'nodeIndex', 'mode']
                      : name === 'manage_group'
                        ? ['action']
                        : name === 'merge_paths'
                          ? ['firstId', 'firstEnd', 'secondId', 'secondEnd']
                          : name === 'straighten_span'
                            ? ['pathId']
                            : name === 'create_path'
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
          <span title={fileName || '未绑定文件'}>
            {fileName || '角色轮廓研究'}
          </span>{' '}
          <i title={saved}>{saved}</i>
        </span>
        <div className="header-actions">
          <button
            aria-label="保存工程"
            title={saved + ' · Ctrl S 保存到同一文件'}
            disabled={fileBusy}
            onClick={() => void saveProject()}
          >
            <Save size={16} />
            <span className="wide-label">保存工程</span>
          </button>
          <button
            title="另存为 Ctrl Shift S"
            disabled={fileBusy}
            onClick={() => void saveProject(true)}
          >
            另存为
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
                if (value === 'trace') setPropertyTab('trace');
                else if (value === 'edit')
                  setPropertyTab(selection ? 'node' : 'paths');
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
              onClick={() => void openProjectFile()}
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
                            data-node-mode={nodeModes(current)[index]}
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
                              rx={
                                nodeModes(current)[index] === 'corner'
                                  ? 0
                                  : 3 / view.s
                              }
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
                              report(
                                closePath(
                                  connectionSettings(
                                    sr.current,
                                    modifierRef.current,
                                  ),
                                ),
                              );
                            }
                          }}
                        />
                      ))}
                    </>
                  )}
                </g>
              )}
              {mergeSource && (
                <g>
                  {coords &&
                    (() => {
                      const source = project.paths.find(
                        (p) => p.id === mergeSource.pathId,
                      );
                      if (!source) return null;
                      const a =
                        mergeSource.end === 'start'
                          ? source.start
                          : source.curves.at(-1)![3];
                      return (
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={coords.x}
                          y2={coords.y}
                          stroke="#6cdef6"
                          strokeDasharray={6 / view.s}
                          strokeWidth={1.5 / view.s}
                          pointerEvents="none"
                        />
                      );
                    })()}
                  {project.paths
                    .filter(
                      (p) =>
                        p.id !== mergeSource.pathId &&
                        p.visible &&
                        !p.closed &&
                        p.curves.length,
                    )
                    .flatMap((path) =>
                      (['start', 'end'] as const).map((end) => {
                        const p =
                          end === 'start' ? path.start : path.curves.at(-1)![3];
                        return (
                          <g
                            key={path.id + end}
                            role="button"
                            aria-label={
                              '合并到 ' +
                              path.name +
                              ' ' +
                              (end === 'start' ? '起点' : '终点')
                            }
                            data-merge-endpoint={path.id + ':' + end}
                            onPointerDown={(e) => {
                              if (e.button !== 0 || space.current) return;
                              e.stopPropagation();
                              e.preventDefault();
                              try {
                                mergePaths({
                                  firstId: mergeSource.pathId,
                                  firstEnd: mergeSource.end,
                                  secondId: path.id,
                                  secondEnd: end,
                                });
                              } catch (e: any) {
                                setStatus(e.message);
                              }
                            }}
                            style={{ cursor: 'crosshair' }}
                          >
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={12 / view.s}
                              fill="transparent"
                            />
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={6 / view.s}
                              fill="#102a35"
                              stroke="#6cdef6"
                              strokeWidth={2 / view.s}
                              pointerEvents="none"
                            />
                            <text
                              x={p.x + 10 / view.s}
                              y={p.y - 10 / view.s}
                              fontSize={11 / view.s}
                              fill="#9becff"
                              paintOrder="stroke"
                              stroke="#102a35"
                              strokeWidth={3 / view.s}
                              pointerEvents="none"
                            >
                              {end === 'start' ? '起' : '终'}
                            </text>
                          </g>
                        );
                      }),
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
                      if (ready && !busy)
                        report(addAnchor(c, connectionSettings(sr.current, e)));
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
                  ? modifiers.altKey
                    ? 'Alt：默认直连 · 不吸附、不拟合'
                    : modifiers.shiftKey
                      ? 'Shift：精确落点 · 暂停吸附，仍沿图像拟合'
                      : 'Shift 不吸附 · Alt 直连 · L 修正上一段'
                  : tool === 'edit'
                    ? mergeSource
                      ? '点击蓝色端点合并 · Esc 取消'
                      : '点选方点 · Delete 删除 · 端点 M 合并 · L 直连'
                    : modifiers.altKey
                      ? 'Alt：默认直连 · 不吸附、不拟合'
                      : modifiers.shiftKey
                        ? 'Shift：精确落点 · 暂停吸附'
                        : '点击落点 · Shift 不吸附 · Alt 直连 · L 修正上一段'}
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
        <div
          className="inspector-resizer"
          role="separator"
          aria-label="调整右侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={240}
          aria-valuemax={600}
          aria-valuenow={inspectorWidth}
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            sidebarDrag.current = { x: e.clientX, width: inspectorWidth };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (sidebarDrag.current)
              setInspectorWidth(
                clampInspector(
                  sidebarDrag.current.width + sidebarDrag.current.x - e.clientX,
                ),
              );
          }}
          onPointerUp={() => {
            sidebarDrag.current = null;
          }}
          onPointerCancel={() => {
            sidebarDrag.current = null;
          }}
          onDoubleClick={() => setInspectorWidth(320)}
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
              e.preventDefault();
              setInspectorWidth((w) =>
                clampInspector(w + (e.key === 'ArrowLeft' ? 20 : -20)),
              );
            }
          }}
        />
        <aside
          className="inspector"
          style={
            {
              '--inspector-width': inspectorWidth + 'px',
            } as React.CSSProperties
          }
        >
          <Tabs
            value={propertyTab}
            onValueChange={(v) => setPropertyTab(v as string)}
            className="property-tabs"
          >
            <TabsList aria-label="属性页签">
              <TabsTrigger value="scene">工程</TabsTrigger>
              <TabsTrigger value="trace">描线</TabsTrigger>
              <TabsTrigger value="paths">路径</TabsTrigger>
              <TabsTrigger value="node">节点</TabsTrigger>
            </TabsList>
          </Tabs>
          <div
            role="tabpanel"
            aria-label="节点属性"
            hidden={propertyTab !== 'node'}
          >
            <section>
              <h3>选中节点</h3>
              <p>{current?.name || '未选中对象'}</p>{' '}
              {current && tool === 'edit' ? (
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
                    disabled={busy || selectedNode(current, selection) === null}
                    onClick={deleteSelection}
                  >
                    <Trash2 size={14} />
                    删除节点 <kbd>Del</kbd>
                  </button>
                  <button
                    style={{ marginTop: 8 }}
                    disabled={busy || !selection || !current.curves.length}
                    onClick={() => {
                      try {
                        straightenSpan(current.id);
                      } catch (e: any) {
                        setStatus(e.message);
                      }
                    }}
                  >
                    此段改为直连 <kbd>L</kbd>
                  </button>
                  <button
                    style={{ marginTop: 8 }}
                    disabled={
                      busy ||
                      current.closed ||
                      !current.curves.length ||
                      ![0, current.curves.length].includes(
                        selectedNode(current, selection) ?? -1,
                      )
                    }
                    onClick={startMerge}
                  >
                    <Link size={14} />
                    连接另一条样条 <kbd>M</kbd>
                  </button>
                  {mergeSource && (
                    <p>
                      点击画布中另一条样条的蓝色端点。
                      <button
                        onClick={() => {
                          setMergeSource(null);
                          setStatus('已取消合并');
                        }}
                      >
                        取消合并 · Esc
                      </button>
                    </p>
                  )}
                  {selectedNode(current, selection) !== null && (
                    <label className="node-mode">
                      节点连接
                      <select
                        aria-label="节点连接模式"
                        value={
                          nodeModes(current)[selectedNode(current, selection)]
                        }
                        onChange={(e) => {
                          try {
                            changeNodeMode({
                              pathId: current.id,
                              nodeIndex: selectedNode(current, selection),
                              mode: e.target.value,
                            });
                          } catch (e: any) {
                            setStatus(e.message);
                          }
                        }}
                      >
                        <option value="corner">尖角 · 独立控制柄</option>
                        <option
                          value="smooth"
                          disabled={
                            !current.closed &&
                            [0, current.curves.length].includes(
                              selectedNode(current, selection),
                            )
                          }
                        >
                          平滑 · 共线
                        </option>
                        <option
                          value="symmetric"
                          disabled={
                            !current.closed &&
                            [0, current.curves.length].includes(
                              selectedNode(current, selection),
                            )
                          }
                        >
                          对称 · C1 连续
                        </option>
                      </select>
                    </label>
                  )}
                  <small>中间节点删除后合为一段 · Ctrl+Z 撤销</small>
                </div>
              ) : (
                <p className="empty-properties">
                  在画布中选择节点，查看连接模式与控制柄。
                  <button
                    onClick={() => {
                      setTool('edit');
                      setPropertyTab('paths');
                    }}
                  >
                    选择路径
                  </button>
                </p>
              )}
            </section>
          </div>
          <div
            role="tabpanel"
            aria-label="描线参数"
            hidden={propertyTab !== 'trace'}
          >
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
                  onCheckedChange={(v) =>
                    setSettings((s) => ({ ...s, snap: v }))
                  }
                />
              </label>
              <div className="path-actions">
                <button disabled={!drawing || busy} onClick={finish}>
                  <Check size={15} />
                  结束
                </button>
                <button
                  disabled={!current?.curves.length || current.closed || busy}
                  onClick={(e) =>
                    report(closePath(connectionSettings(sr.current, e)))
                  }
                >
                  <Link size={15} />
                  闭合
                </button>
              </div>
            </section>
          </div>
          <div
            role="tabpanel"
            aria-label="路径与分组"
            hidden={propertyTab !== 'paths'}
          >
            <section className="paths-section">
              <div className="section-title">
                <h3>
                  曲线路径{' '}
                  <span className="counter">{project.paths.length}</span>
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
              <button
                className="group-new"
                onClick={() =>
                  manageGroup({
                    action: 'create',
                    name: '分组 ' + ((project.groups?.length || 0) + 1),
                  })
                }
              >
                <Plus size={13} />
                新建分组
              </button>
              {!project.paths.length && !project.groups?.length ? (
                <div className="empty-path">
                  <Spline size={25} />
                  <p>从一个锚点开始</p>
                  <small>每条路径可独立编辑和导出</small>
                </div>
              ) : (
                <div className="path-list">
                  {[...(project.groups || []), { id: '', name: '未分组' }].map(
                    (group) => {
                      const members = project.paths.filter(
                        (p) => (p.groupId || '') === group.id,
                      );
                      if (
                        !group.id &&
                        !members.length &&
                        !project.groups?.length
                      )
                        return null;
                      return (
                        <details
                          className={
                            'path-group ' +
                            (dropTarget === 'g:' + group.id
                              ? 'drop-target'
                              : '')
                          }
                          key={group.id}
                          open={!collapsedGroups[group.id]}
                          data-group-id={group.id}
                          onDragOver={(e) => {
                            if (draggedPath.current) {
                              e.preventDefault();
                              e.stopPropagation();
                              e.dataTransfer.dropEffect = 'move';
                              setDropTarget('g:' + group.id);
                            }
                          }}
                          onDrop={(e) => dropPath(e, group.id)}
                        >
                          <summary onClick={(e) => e.preventDefault()}>
                            <button
                              className="group-toggle"
                              aria-label={
                                (collapsedGroups[group.id]
                                  ? '展开分组 '
                                  : '折叠分组 ') + group.name
                              }
                              aria-expanded={!collapsedGroups[group.id]}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCollapsedGroups((v) => ({
                                  ...v,
                                  [group.id]: !v[group.id],
                                }));
                              }}
                            >
                              ▸
                            </button>
                            {renamingGroup?.id === group.id ? (
                              <input
                                aria-label="重命名分组"
                                autoFocus
                                value={renamingGroup.name}
                                ref={(el) => {
                                  el?.focus();
                                }}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) =>
                                  setRenamingGroup({
                                    ...renamingGroup,
                                    name: e.target.value,
                                  })
                                }
                                onClick={(e) => e.stopPropagation()}
                                onBlur={finishGroupRename}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    finishGroupRename();
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setRenamingGroup(null);
                                  }
                                }}
                              />
                            ) : (
                              <span
                                className="group-title"
                                title={
                                  group.id
                                    ? '双击重命名 · 拖入路径加入分组'
                                    : '拖入路径移出分组'
                                }
                                onDoubleClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (group.id)
                                    setRenamingGroup({
                                      id: group.id,
                                      name: group.name,
                                    });
                                }}
                              >
                                {group.name}
                              </span>
                            )}
                            <div className="group-controls">
                              <small>{members.length}</small>
                              {group.id && (
                                <>
                                  <button
                                    aria-label={'显示隐藏分组 ' + group.name}
                                    title="整组显示 / 隐藏"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      manageGroup({
                                        action: 'visibility',
                                        id: group.id,
                                        visible: !members.some(
                                          (p) => p.visible,
                                        ),
                                      });
                                    }}
                                  >
                                    {members.some((p) => p.visible) ? (
                                      <Eye size={14} />
                                    ) : (
                                      <EyeOff size={14} />
                                    )}
                                  </button>
                                  <button
                                    aria-label={'解散分组 ' + group.name}
                                    title="解散分组，保留路径"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      manageGroup({
                                        action: 'delete',
                                        id: group.id,
                                      });
                                    }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </summary>
                          {members.map((path) => (
                            <div
                              key={path.id}
                              draggable={!busy && renamingPath?.id !== path.id}
                              data-path-id={path.id}
                              onDragStart={(e) => {
                                draggedPath.current = path.id;
                                e.dataTransfer.setData(
                                  'application/x-bezier-path',
                                  path.id,
                                );
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragEnd={() => {
                                draggedPath.current = null;
                                setDropTarget(null);
                              }}
                              onDragOver={(e) => {
                                if (draggedPath.current) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setDropTarget('p:' + path.id);
                                }
                              }}
                              onDrop={(e) => dropPath(e, group.id, path.id)}
                              className={`path-row ${dropTarget === 'p:' + path.id ? 'drop-before' : ''}  ${path.id === active ? 'active' : ''}`}
                            >
                              {renamingPath?.id === path.id ? (
                                <div className="path-select path-name-edit">
                                  <span
                                    className="path-swatch"
                                    style={{ background: path.color }}
                                  />
                                  <input
                                    aria-label="重命名路径"
                                    autoFocus
                                    maxLength={120}
                                    value={renamingPath.name}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) =>
                                      setRenamingPath({
                                        ...renamingPath,
                                        name: e.target.value,
                                      })
                                    }
                                    onBlur={finishPathRename}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        finishPathRename();
                                      }
                                      if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setRenamingPath(null);
                                      }
                                    }}
                                  />
                                </div>
                              ) : (
                                <button
                                  className="path-select"
                                  onClick={() => {
                                    setActiveNow(path.id);
                                    finish();
                                    setSelection(null);
                                  }}
                                >
                                  <span
                                    className="drag-grip"
                                    aria-hidden="true"
                                  >
                                    ⠿
                                  </span>
                                  <span
                                    className="path-swatch"
                                    style={{ background: path.color }}
                                  />
                                  <span>
                                    <span
                                      className="path-title"
                                      title="双击重命名"
                                      onDoubleClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setRenamingPath({
                                          id: path.id,
                                          name: path.name,
                                        });
                                      }}
                                    >
                                      {path.name}
                                    </span>
                                    <small>
                                      {path.closed ? '闭合' : '开放'} ·{' '}
                                      {path.curves.length} 段
                                      {path.quality < 0.35 ? ' · 待检查' : ''}
                                    </small>
                                  </span>
                                </button>
                              )}
                              <button
                                aria-label={`切换可见性 ${path.name}`}
                                title="切换可见性"
                                onClick={() =>
                                  transact((p) => {
                                    const q = p.paths.find(
                                      (x) => x.id === path.id,
                                    )!;
                                    q.visible = !q.visible;
                                  })
                                }
                              >
                                {path.visible ? (
                                  <Eye size={15} />
                                ) : (
                                  <EyeOff size={15} />
                                )}
                              </button>
                            </div>
                          ))}
                          {!members.length && (
                            <small className="group-empty">
                              将路径拖到这里移入分组。
                            </small>
                          )}
                        </details>
                      );
                    },
                  )}
                </div>
              )}
              {current && (
                <>
                  <details className="advanced-actions">
                    <summary>高级操作</summary>
                    <p>会替换当前路径的手动调整。</p>
                    <button
                      disabled={busy || !ready || current.anchors.length < 2}
                      onClick={() => requestRefit()}
                    >
                      重新拟合当前路径…
                    </button>
                  </details>
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
          </div>
          <div
            role="tabpanel"
            aria-label="工程设置"
            hidden={propertyTab !== 'scene'}
          >
            <section>
              <h3>当前工程</h3>
              <p>
                {project.imageName} · {project.width} × {project.height}
              </p>
              <p>{saved}</p>
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
          </div>
        </aside>
      </div>
      <footer>
        <span role="status">
          <span className="live-dot" />
          {status}
        </span>
        <span className="storage-status" aria-live="polite" title={saved}>
          {saved}
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
        open={!!pendingRefit}
        onOpenChange={(open) => {
          if (!open) setPendingRefit(null);
        }}
      >
        <DialogContent>
          <DialogTitle>确认重新拟合当前路径？</DialogTitle>
          <DialogDescription>
            将重新计算「{pendingRefit?.name}」的全部 {pendingRefit?.segments}{' '}
            段曲线，仅影响这一条路径。手动控制柄调整和节点连续模式会被替换，其他路径不变。完成后可用
            Ctrl+Z 撤销。
          </DialogDescription>
          <div className="confirm-actions">
            <button autoFocus onClick={() => setPendingRefit(null)}>
              取消，保留现有曲线
            </button>
            <button
              className="danger-action"
              disabled={busy}
              onClick={() => {
                const request = pendingRefit;
                if (!request) return;
                setPendingRefit(null);
                if (pr.current !== request.snapshot) {
                  setStatus('工程已改变，请重新打开确认操作');
                  return;
                }
                report(refitPath({ id: request.id }));
              }}
            >
              确认替换并重拟合
            </button>
          </div>
        </DialogContent>
      </Dialog>
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
                <button onClick={() => exportFile('json')}>下载工程副本</button>
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
                可用操作：state、detect_candidates、create_path、commit_preview、discard_preview、get_project、select_path、select_node、delete_node、merge_paths、straighten_span、refit_path、set_node_mode、manage_group、set_point、set_view、undo、inspect_geometry、export、load_project。
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
                　选“深色线条”跟随描边；选“颜色边缘”跟随色块交界。底图可拖入。按住
                Shift 落点不吸附；Alt 落点跳过拟合并直接连接，松开恢复原设置。
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
                取消选中。所有修改可用 Ctrl+Z 撤销。选开放端点后按
                M，再点击另一条样条的蓝色端点可合并。L
                将选中节点对应的段（或描线时的最后一段）改为直连。
              </p>
              <p>
                <b>5. 保存与导出</b>　工程自动备份到浏览器；Ctrl S
                首次绑定文件，之后直接写回。Ctrl Shift S
                另存为。打开工程会绑定所选文件。导出 SVG 或 Blender
                脚本时按整张底图设置毫米尺寸。
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
