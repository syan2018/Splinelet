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
  PaintBucket,
  ArrowUpFromLine,
  Box,
} from 'lucide-react';
import { Outliner } from '@/components/source-editor/outliner';
import { modelTools } from '@/lib/model-api';
import ModelWorkspace from '@/components/modeling/model-workspace';
import CreationWorkspace from '@/components/creation/creation-workspace';
import {
  SplinePathInspector,
  SplineNodeInspector,
  SplineTraceControls,
} from '@/components/source-editor/spline-inspector';
import { splineEndpoint, extendSpline } from '../public/extend.mjs';
import SplineEndpoints from '@/components/source-editor/spline-endpoints';
import {
  cloneTraceValue,
  initialTraceProject,
  type TraceCandidate,
  type TraceSettings,
} from '@/components/source-editor/trace-editor-state';
import { creationTools } from '@/lib/creation-api';
import {
  pickSelection,
  movePaths,
  translatePaths,
  translateNodes,
  deleteNodes,
  inBox,
  pathHitsBox,
} from '../public/selection.mjs';
// @ts-ignore Pure, zoom-safe SVG gesture and framing math.
import {
  screenToDocument,
  zoomAt,
  framePathsView,
} from '../public/canvas-gestures.mjs';
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
  setContinuity,
  moveHandle,
  enforceContinuity,
} from '../public/continuity.mjs';
export default function Home() {
  const [workspace, setWorkspace] = useState('trace');
  const modelApi = useRef<any>(null);
  const creationApi = useRef<any>(null);
  const [unified, setUnified] = useState(true);
  const [creationView, setCreationView] = useState('flat');
  const [creationSelectionKind, setCreationSelectionKind] = useState<
    'object' | 'path' | 'cell'
  >('object');
  const highlightSourceSelection = !unified || creationSelectionKind !== 'cell';
  const creationViewRef = useRef('flat'),
    unifiedRef = useRef(true);
  creationViewRef.current = creationView;
  unifiedRef.current = unified;
  const [creationLayer, setCreationLayer] = useState<SVGGElement | null>(null);
  const [project, setProject] = useState<Project>(initialTraceProject),
    pr = useRef(project);
  const [active, setActive] = useState<string | null>(null),
    ar = useRef(active);
  ar.current = active;
  const [tool, setTool] = useState('select'),
    [drawing, setDrawing] = useState(false),
    drawingRef = useRef(false);
  drawingRef.current = drawing;
  const [drawingEnd, setDrawingEnd] = useState<'start' | 'end'>('end');
  const drawingEndRef = useRef<'start' | 'end'>('end');
  const setTraceEnd = (end: 'start' | 'end') => {
    drawingEndRef.current = end;
    setDrawingEnd(end);
  };
  const [settings, setSettings] = useState<TraceSettings>({
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
  const [candidates, setCandidates] = useState<TraceCandidate[]>([]),
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
    [selection, setPointSelection] = useState<{
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
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]),
    pathsRef = useRef<string[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<number[]>([]),
    nodesRef = useRef<number[]>([]);
  const rangeAnchor = useRef<string | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [gesturing, setGesturing] = useState(false);
  const lastNodeTap = useRef<{
    pathId: string;
    index: number;
    time: number;
  } | null>(null);
  const selectNodesNow = (ids: number[]) => {
    nodesRef.current = ids;
    setSelectedNodes(ids);
  };
  const setSelection = (value: { curve: number; point: number } | null) => {
    setPointSelection(value);
    const path = pr.current.paths.find((p) => p.id === ar.current),
      node = selectedNode(path, value);
    selectNodesNow(node === null ? [] : [node]);
  };
  const selectPathsNow = (ids: string[], primary?: string | null) => {
    const valid = [...new Set(ids)].filter((id) =>
      pr.current.paths.some((p) => p.id === id),
    );
    const id =
      primary && valid.includes(primary) ? primary : valid.at(-1) || null;
    setActiveNow(id);
    pathsRef.current = valid;
    setSelectedPaths(valid);
  };
  const chooseTool = (next: string) => {
    if (unified && ['trace', 'edit'].includes(next)) setCreationView('flat');
    if (drag.current) cancelGesture();
    if (next !== 'trace') finish();
    setTool(next);
    if (next === 'edit') {
      if (pathsRef.current.length > 1)
        selectPathsNow(ar.current ? [ar.current] : []);
      if (unified)
        creationApi.current?.select_paths(ar.current ? [ar.current] : []);
      setPropertyTab('node');
    }
    if (next === 'select') {
      setSelection(null);
      setPropertyTab('paths');
    }
    if (next === 'trace') setPropertyTab('trace');
    stage.current?.focus({ preventScroll: true });
    setStatus(
      next === 'select'
        ? unified
          ? '选择 · 点击区域或线条 · Ctrl / Shift 多选 · 空白取消'
          : '选择路径 · 多选后可整体移动或编组'
        : next === 'edit'
          ? '编辑节点 · Shift 多选 · 空白拖动框选'
          : next === 'trace'
            ? '点击轮廓落点 · Shift 不吸附 · Alt 直连'
            : next === 'paint'
              ? '点击上色 · 平面中按住扫过多个区域 · 一笔一次撤销'
              : next === 'height'
                ? '选择局部或整个部件 · 拖动高度柄或输入毫米数值'
                : '拖动画布平移',
    );
  };
  const clearSelection = () => {
    if (unified) creationApi.current?.clear();
    rangeAnchor.current = null;
    finish();
    setSelection(null);
    selectPathsNow([]);
    setStatus('已取消选择');
  };
  const choosePath = (
    id: string,
    e: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
    order: string[],
  ) => {
    if (busyRef.current || drag.current) return;
    finish();
    setSelection(null);
    setTool('select');
    setPropertyTab('paths');
    const ids = pickSelection(pathsRef.current, id, order, {
      toggle: !!(e.ctrlKey || e.metaKey),
      range: !!e.shiftKey,
      anchor: rangeAnchor.current as any,
    });
    selectPathsNow(ids, id);
    if (!e.shiftKey) rangeAnchor.current = id;
    setStatus(
      ids.length
        ? '已选 ' + ids.length + ' 条路径 · 拖动移动或编组'
        : '已取消选择',
    );
  };
  const chooseGroup = (ids: string[], add: boolean) => {
    if (busyRef.current || drag.current) return;
    finish();
    setTool('select');
    setPropertyTab('paths');
    setSelection(null);
    selectPathsNow(
      add
        ? ids.every((id) => pathsRef.current.includes(id))
          ? pathsRef.current.filter((id) => !ids.includes(id))
          : [...pathsRef.current, ...ids]
        : ids,
    );
    setStatus(
      pathsRef.current.length
        ? '已选 ' + pathsRef.current.length + ' 条路径 · 拖动移动或编组'
        : '已取消选择',
    );
  };
  const setVisible = (ids: string[], visible: boolean) => {
    if (busyRef.current || drag.current) return;
    transact((p) =>
      p.paths
        .filter((p) => ids.includes(p.id))
        .forEach((p) => (p.visible = visible)),
    );
    if (!visible)
      selectPathsNow(pathsRef.current.filter((id) => !ids.includes(id)));
    setStatus(visible ? '已显示路径 · 可撤销' : '已隐藏路径 · 可撤销');
  };
  const groupSelection = () => {
    if (busyRef.current || drag.current) return;
    const ids = pathsRef.current,
      id = crypto.randomUUID();
    transact((p) => {
      (p.groups ||= []).push({
        id,
        name: '分组 ' + ((p.groups?.length || 0) + 1),
      });
      p.paths
        .filter((p) => ids.includes(p.id))
        .forEach((p) => (p.groupId = id));
    });
    setStatus(
      ids.length
        ? '已将 ' + ids.length + ' 条路径编组 · Ctrl+Z 撤销'
        : '已创建空分组 · 拖入路径',
    );
  };
  const deletePaths = () => {
    if (busyRef.current || drag.current || !pathsRef.current.length) return;
    const ids = pathsRef.current;
    transact((p) => (p.paths = p.paths.filter((p) => !ids.includes(p.id))));
    clearSelection();
    setStatus('已删除 ' + ids.length + ' 条路径 · Ctrl+Z 撤销');
  };
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
    if (drag.current?.base && snapshot === pr.current)
      snapshot = drag.current.base;
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
          suggestedName: fileName || 'Splinelet工程.bezier.json',
          types: [
            {
              description: 'Splinelet工程',
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
            description: 'Splinelet工程',
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
      history.current.push(cloneTraceValue(pr.current));
      if (history.current.length > 80) history.current.shift();
      future.current = [];
    }
    pr.current = p;
    setProject(p);
    setHistoryTick((t) => t + 1);
  };
  const transact = (fn: (p: Project) => void) => {
    const p = cloneTraceValue(pr.current);
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
    pathsRef.current = id ? [id] : [];
    setSelectedPaths(pathsRef.current);
  };
  const fitView = () => {
    if (!stage.current) return;
    const r = stage.current.getBoundingClientRect(),
      p = pr.current,
      s = Math.min(
        (r.width - 80) / p.width,
        (r.height - (unified ? 180 : 110)) / p.height,
      );
    setView({
      s: Math.max(0.05, s),
      x: (r.width - p.width * s) / 2,
      y: (r.height - p.height * s) / 2 - 5,
    });
  };
  const framePaths = (
    ids: string[],
    { force = false }: { force?: boolean } = {},
  ) => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Creation's top bar and bottom palette cover these edges of the SVG.
    // Frame inside the usable window so the selected outline remains readable.
    const inset = unified
      ? {
          x: 16,
          y: 86,
          width: Math.max(1, r.width - 32),
          height: Math.max(1, r.height - 202),
        }
      : {
          x: 16,
          y: 42,
          width: Math.max(1, r.width - 32),
          height: Math.max(1, r.height - 106),
        };
    const next = framePathsView(
      pr.current.paths.filter((path) => ids.includes(path.id) && path.visible),
      inset,
      vr.current,
      { force },
    );
    if (next) setView(next);
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
    const startingProject = pr.current;
    workspaceDB('get')
      .then(async (session: any) => {
        let v = session?.project;
        if (!v) {
          try {
            const r = await fetch('/character-example.bezier.json');
            if (r.ok) v = await r.json();
          } catch {}
        }
        // A late restore must never replace an import or edit made meanwhile.
        if (v && alive && pr.current === startingProject) {
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
    if (!initialized || gesturing) return;
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
  }, [project, initialized, bindingVersion, gesturing]);
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
        setStatus('底图就绪');
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
    let previous: { width: number; height: number } | null = null;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!previous) fitView();
      else {
        const dx = (width - previous.width) / 2,
          dy = (height - previous.height) / 2;
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      }
      previous = { width, height };
    });
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  const undo = () => {
    if (busyRef.current || drag.current) return;
    lastNodeTap.current = null;
    const p = history.current.pop();
    if (!p) return;
    future.current.push(cloneTraceValue(pr.current));
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
    if (p.paths.find((x) => x.id === ar.current)?.closed) finish();
    selectPathsNow(
      pathsRef.current.filter((id) => p.paths.some((v) => v.id === id)),
    );
    setStatus('已撤销');
  };
  const redo = () => {
    if (busyRef.current || drag.current) return;
    lastNodeTap.current = null;
    const p = future.current.pop();
    if (!p) return;
    history.current.push(cloneTraceValue(pr.current));
    setDoc(p, false);
    setSelection(null);
    setMergeSource(null);
    if (!p.paths.some((x) => x.id === ar.current && !x.closed)) finish();
    selectPathsNow(
      pathsRef.current.filter((id) => p.paths.some((v) => v.id === id)),
    );
    setStatus('已重做');
  };
  const finish = () => {
    lastNodeTap.current = null;
    setMergeSource(null);
    setDrawing(false);
    drawingRef.current = false;
    setPreview([]);
    previewToken.current++;
    setStatus('路径已结束 · 可编辑节点，或新建下一条路径');
  };
  const begin = () => {
    finish();
    setTraceEnd('end');
    setActiveNow(null);
    setTool('trace');
    setPropertyTab('trace');
    setSelection(null);
    setStatus('点击新的轮廓起点');
  };
  const resumePath = (pathId: string, end: 'start' | 'end') => {
    if (busyRef.current || drag.current) throw Error('请先完成当前操作');
    if (!ready) throw Error('底图尚未准备好');
    const path = pr.current.paths.find((p) => p.id === pathId);
    const point = splineEndpoint(path, end);
    if (!path?.visible) throw Error('请先显示这条样条');
    finish();
    setSelection(null);
    selectPathsNow([pathId], pathId);
    if (unified) creationApi.current?.select_paths([pathId]);
    setTraceEnd(end);
    chooseTool('trace');
    setDrawing(true);
    drawingRef.current = true;
    setStatus(
      `从${end === 'start' ? '头' : '尾'}端点续画 · 点击落点 · 点击另一端闭合 · Esc 结束`,
    );
    return { pathId, end, point };
  };
  const resumeSelected = (end: 'start' | 'end') => {
    try {
      resumePath(ar.current || '', end);
    } catch (e: any) {
      setStatus(e.message);
    }
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
    options: Partial<TraceSettings> = {},
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
  const addAnchor = async (p: Point, options: Partial<TraceSettings> = {}) =>
    lock(async () => {
      validPoint(p);
      const config = { ...sr.current, ...options };
      const current = pr.current.paths.find((p) => p.id === ar.current);
      if (!drawingRef.current || !current || current.closed) {
        setTraceEnd('end');
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
        const creation = unified ? creationApi.current?.new_path(path) : null;
        transact((p) => {
          p.paths.push(path);
          if (creation) {
            p.creation = creation;
            p.version = 3;
          }
        });
        setActiveNow(path.id);
        setDrawing(true);
        drawingRef.current = true;
        setStatus('移动查看预览，点击落下下一锚点');
        return start;
      }
      const end = drawingEndRef.current;
      const a = splineEndpoint(current, end);
      if (dist(a, p) < 2) return a;
      const r = await traceSpan(a, p, config);
      transact((p) => {
        const index = p.paths.findIndex((v) => v.id === current.id);
        p.paths[index] = extendSpline(p.paths[index], end, r);
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
  const closePath = async (options: Partial<TraceSettings> = {}) =>
    lock(async () => {
      const path = pr.current.paths.find((p) => p.id === ar.current);
      if (!path || path.curves.length < 1) throw Error('至少先绘制一段曲线');
      if (path.closed) return;
      const end = drawingRef.current ? drawingEndRef.current : 'end';
      const r = await traceSpan(
        splineEndpoint(path, end),
        splineEndpoint(path, end === 'start' ? 'end' : 'start'),
        options,
        false,
      );
      transact((p) => {
        const index = p.paths.findIndex((x) => x.id === path.id);
        p.paths[index] = extendSpline(p.paths[index], end, r, true);
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
    if (busyRef.current || drag.current) return;
    if (tool === 'select') {
      deletePaths();
      return;
    }
    const path = pr.current.paths.find((p) => p.id === ar.current),
      ids = nodesRef.current;
    if (tool !== 'edit' || !path || !ids.length) {
      setStatus('请选择节点后删除；路径选择模式可删除整条路径');
      return;
    }
    try {
      const result = deleteNodes(path, ids, sr.current.tolerance);
      transact(
        (p) =>
          (p.paths = result
            ? p.paths.map((p) => (p.id === path.id ? result : p))
            : p.paths.filter((p) => p.id !== path.id)),
      );
      setSelection(null);
      if (!result) selectPathsNow([]);
      setStatus(
        '已删除 ' + ids.length + ' 个节点 · 相邻节点直接连接 · Ctrl+Z 撤销',
      );
    } catch (e: any) {
      setStatus(e.message);
    }
  };
  const straightenSpan = (pathId: string, curve?: number) => {
    if (busyRef.current || drag.current) throw Error('请先完成当前操作');
    if (curve === undefined && tool === 'edit' && nodesRef.current.length > 1)
      throw Error('请选择单个节点或控制柄来指定曲线段');
    const path = pr.current.paths.find((p) => p.id === pathId);
    const index =
      curve ??
      (tool === 'edit' && ar.current === pathId && selection
        ? selection.curve
        : tool === 'trace' &&
            drawingRef.current &&
            drawingEndRef.current === 'start'
          ? 0
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
    const node =
      nodesRef.current.length === 1 ? selectedNode(path, selection) : null;
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
  const coordinate = (event: { clientX: number; clientY: number }) =>
    screenToDocument(
      event,
      stage.current!.getBoundingClientRect(),
      vr.current,
    ) || { x: 0, y: 0 };
  const inside = (p: Point) =>
    p.x >= 0 && p.y >= 0 && p.x < pr.current.width && p.y < pr.current.height;
  const cancelGesture = () => {
    const g = drag.current;
    if (!g) return;
    if (g.base) {
      pr.current = g.base;
      setProject(g.base);
    }
    if (g.kind === 'pan') setView(g.view);
    drag.current = null;
    setMarquee(null);
    setGesturing(false);
    setStatus('已取消拖动，恢复原位置');
  };
  const startPathDrag = (
    e: React.PointerEvent,
    id: string,
    fromSource = true,
  ) => {
    if (space.current || e.button === 1 || tool === 'pan') return;
    if (
      !['select', 'edit'].includes(tool) ||
      e.button !== 0 ||
      busyRef.current ||
      mergeSource
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    stage.current?.focus({ preventScroll: true });
    if (tool === 'edit') {
      setActiveNow(id);
      setSelection(null);
      setPropertyTab('node');
      if (unified && fromSource) creationApi.current?.select_paths([id]);
      return;
    }
    setSelection(null);
    const modified = e.shiftKey || e.ctrlKey || e.metaKey;
    const existing =
      unified && fromSource && creationSelectionKind !== 'path'
        ? []
        : pathsRef.current;
    const ids = (
      modified
        ? pickSelection(existing, id, [], { toggle: true })
        : existing.includes(id)
          ? existing
          : [id]
    ).filter(
      (id: string) =>
        !fromSource || pr.current.paths.find((p) => p.id === id)?.visible,
    );
    // A face projects its owner paths for movement; that projection must not
    // replace the semantic face selection or leave hidden boundary lines behind.
    if (fromSource) {
      selectPathsNow(ids, id);
      if (unified) creationApi.current?.select_paths(ids);
    }
    setPropertyTab('paths');
    if (modified) return;
    drag.current = {
      kind: 'paths',
      ids: ids.filter(
        (id: string) =>
          !fromSource || pr.current.paths.find((p) => p.id === id)?.visible,
      ),
      base: pr.current,
      origin: coordinate(e),
      x: e.clientX,
      y: e.clientY,
      moved: false,
      collapsePath: fromSource && ids.length > 1 ? id : null,
    };
    setGesturing(true);
    stage.current?.setPointerCapture(e.pointerId);
  };
  const pointerDown = (e: React.PointerEvent) => {
    if (
      e.button === 2 ||
      (e.target as HTMLElement).closest?.('button,input,select')
    )
      return;
    updateModifiers(e);
    stage.current?.focus({ preventScroll: true });
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
    if (busyRef.current || e.button !== 0 || mergeSource) return;
    if (unified && ['paint', 'height'].includes(tool)) {
      creationApi.current?.clear();
      return;
    }
    if (tool === 'select' || tool === 'edit') {
      e.preventDefault();
      drag.current = {
        kind: 'box',
        origin: p,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        add: e.shiftKey || e.ctrlKey || e.metaKey,
        oldPaths: pathsRef.current.filter(
          (id) => pr.current.paths.find((p) => p.id === id)?.visible,
        ),
        oldNodes: [...nodesRef.current],
      };
      stage.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'trace' && ready && inside(p))
      report(addAnchor(p, connectionSettings(sr.current, e)));
  };
  const pointerMove = (e: React.PointerEvent) => {
    if (unified && creationView === '3d') return;
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
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;
        g.moved = true;
      }
      if (g.kind === 'box') {
        g.rect = {
          x: Math.min(p.x, g.origin.x),
          y: Math.min(p.y, g.origin.y),
          width: Math.abs(p.x - g.origin.x),
          height: Math.abs(p.y - g.origin.y),
        };
        setMarquee(g.rect);
        return;
      }
      const q: Project = {
        ...g.base,
        paths: g.base.paths.map((path: TracePath) =>
          (g.kind === 'paths' ? g.ids.includes(path.id) : path.id === g.path)
            ? cloneTraceValue(path)
            : path,
        ),
      };
      let dx = p.x - g.origin.x,
        dy = p.y - g.origin.y;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (g.kind === 'paths') translatePaths(q, g.ids, dx, dy);
      else {
        const path = q.paths.find((p) => p.id === g.path);
        if (!path) return;
        if (g.kind === 'nodes') translateNodes(path, g.ids, dx, dy);
        else {
          const original = g.base.paths.find((p: TracePath) => p.id === g.path)
            .curves[g.curve][g.point];
          moveHandle(path, g.curve, g.point, {
            x: original.x + dx,
            y: original.y + dy,
          });
          path.anchors = pathNodes(path);
          delete path.fitError;
        }
      }
      pr.current = q;
      setProject(q);
      setStatus(
        '移动 X ' +
          dx.toFixed(1) +
          ' / Y ' +
          dy.toFixed(1) +
          ' px · Shift 限制方向 · Esc 取消',
      );
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
    const a = splineEndpoint(path, drawingEndRef.current);
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
      splineEndpoint(path, drawingEndRef.current),
      p,
      connectionSettings(sr.current, modifiers),
    )
      .then((r) => {
        if (previewToken.current === token && !busyRef.current)
          setPreview(r.curves);
      })
      .catch(() => {});
  }, [modifiers.shiftKey, modifiers.altKey, drawingEnd]);
  useEffect(() => {
    if (tool !== 'edit') setMergeSource(null);
  }, [tool]);
  const pointerUp = () => {
    if (unified && creationView === '3d') return;
    const g = drag.current;
    if (!g) return;
    drag.current = null;
    setMarquee(null);
    setGesturing(false);
    if (!g.moved && g.collapsePath) {
      selectPathsNow([g.collapsePath], g.collapsePath);
      if (unified) creationApi.current?.select_paths([g.collapsePath]);
    }
    if (!g.moved && g.collapseNode !== undefined) {
      const path = pr.current.paths.find((p) => p.id === g.path);
      if (path) setSelection(nodeSelection(path, g.collapseNode));
    }
    // Pointer capture retargets native click/dblclick to the stage. Recognize
    // two completed, unmoved endpoint taps here, after releasing the gesture.
    if (g.kind === 'nodes' && !g.moved) {
      const path = pr.current.paths.find((p) => p.id === g.path);
      const index = selectedNode(path, { curve: g.curve, point: g.point });
      const previous = lastNodeTap.current;
      lastNodeTap.current =
        path && index !== null
          ? { pathId: path.id, index, time: performance.now() }
          : null;
      if (
        path &&
        !path.closed &&
        index !== null &&
        [0, path.curves.length].includes(index) &&
        previous?.pathId === path.id &&
        previous.index === index &&
        performance.now() - previous.time < 400
      ) {
        resumeSelected(index === 0 ? 'start' : 'end');
        return;
      }
    } else lastNodeTap.current = null;
    if (g.kind === 'box') {
      if (tool === 'select') {
        const hits = g.moved
          ? pr.current.paths
              .filter((p) => p.visible && pathHitsBox(p, g.rect))
              .map((p) => p.id)
          : [];
        selectPathsNow(g.add ? [...g.oldPaths, ...hits] : hits);
        if (unified && !g.add && !hits.length) creationApi.current?.clear();
        setSelection(null);
        setStatus(
          hits.length ? '框选 ' + hits.length + ' 条路径' : '已取消路径选择',
        );
      } else {
        const path = pr.current.paths.find((p) => p.id === ar.current);
        const hits =
          g.moved && path?.visible
            ? pathNodes(path).flatMap((p: Point, i: number) =>
                inBox(p, g.rect) ? [i] : [],
              )
            : [];
        const ids = g.add
          ? [...new Set<number>([...g.oldNodes, ...hits])]
          : hits;
        setSelection(
          path && ids.length ? nodeSelection(path, ids.at(-1)) : null,
        );
        selectNodesNow(ids);
        setStatus(
          ids.length
            ? '已选 ' + ids.length + ' 个节点'
            : '已取消节点选择 · 路径仍处于编辑中',
        );
      }
      return;
    }
    if (g.moved && g.base) {
      if (JSON.stringify(pr.current.paths) !== JSON.stringify(g.base.paths)) {
        history.current.push(g.base);
        if (history.current.length > 80) history.current.shift();
        future.current = [];
        setHistoryTick((t) => t + 1);
      }
      setStatus(
        (g.kind === 'paths' ? '路径' : g.kind === 'nodes' ? '节点' : '控制柄') +
          '已移动 · Ctrl+Z 撤销',
      );
    }
  };
  const startPointDrag = (
    e: React.PointerEvent,
    curve: number,
    point: number,
  ) => {
    if (space.current || e.button === 1 || tool === 'pan') return;
    e.stopPropagation();
    if (tool !== 'edit' || busyRef.current || e.button !== 0 || mergeSource)
      return;
    e.preventDefault();
    stage.current?.focus({ preventScroll: true });
    const path = pr.current.paths.find((p) => p.id === ar.current);
    if (!path) return;
    const index = selectedNode(path, { curve, point });
    let ids: number[] = [];
    if (index !== null) {
      const modified = e.shiftKey || e.ctrlKey || e.metaKey;
      ids = modified
        ? pickSelection(nodesRef.current, index, [], { toggle: true })
        : nodesRef.current.includes(index)
          ? nodesRef.current
          : [index];
      setSelection(
        ids.length
          ? nodeSelection(path, ids.includes(index) ? index : ids.at(-1))
          : null,
      );
      selectNodesNow(ids);
      if (modified) {
        lastNodeTap.current = null;
        return;
      }
    } else setSelection({ curve, point });
    drag.current = {
      kind: index === null ? 'point' : 'nodes',
      path: ar.current,
      ids,
      curve,
      point,
      x: e.clientX,
      y: e.clientY,
      origin: coordinate(e),
      base: pr.current,
      moved: false,
      ...(index !== null && ids.length > 1 ? { collapseNode: index } : {}),
    };
    setPropertyTab('node');
    setGesturing(true);
    stage.current?.setPointerCapture(e.pointerId);
  };
  const splitAt = (e: React.MouseEvent, pathId: string) => {
    e.stopPropagation();
    if (busyRef.current) return;
    if (tool === 'select') {
      setActiveNow(pathId);
      chooseTool('edit');
      return;
    }
    if (tool !== 'edit') return;
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
    setActiveNow(pathId);
    setSelection({ curve: best.i, point: 3 });
    setStatus('已精确拆分，形状保持不变；受影响的对称节点改为平滑连接');
  };
  const zoom = (factor: number, center?: Point) => {
    const r = stage.current!.getBoundingClientRect(),
      c = center || { x: r.width / 2, y: r.height / 2 };
    setView((v) => {
      return zoomAt(v, factor, c);
    });
  };
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (unifiedRef.current && creationViewRef.current === '3d') return;
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
        workspace !== 'trace' &&
        !((e.ctrlKey || e.metaKey) && ['z', 's'].includes(e.key.toLowerCase()))
      )
        return;
      if (e.defaultPrevented) return;
      updateModifiers(e);
      // Select menus have no text-edit undo stack. Keep document undo/redo
      // available after a keyboard selection, without enabling drawing hotkeys.
      const historyShortcut =
        (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,[role="slider"],[contenteditable="true"],[role="dialog"]',
        ) ||
        ((e.target as HTMLElement).closest('select') && !historyShortcut) ||
        dialog ||
        pendingRefit
      )
        return;
      if (
        e.key === 'Enter' &&
        (e.target as HTMLElement).closest('button,summary')
      )
        return;
      if (e.key === 'Escape' && drag.current) {
        e.preventDefault();
        cancelGesture();
        return;
      }
      if (drag.current) return;
      if (e.code === 'Space') {
        // Remember the modifier even when a toolbar button still has focus.
        // A subsequent canvas press can pan; keyboard button activation remains native.
        space.current = true;
        if (!(e.target as HTMLElement).closest('button,summary'))
          e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveProject(e.shiftKey);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const inTree = (e.target as HTMLElement).closest('.outliner');
        if (tool === 'edit' && !inTree) {
          const path = pr.current.paths.find((p) => p.id === ar.current);
          if (path) {
            const ids = pathNodes(path).map((_: Point, i: number) => i);
            setSelection(nodeSelection(path, ids.at(-1)));
            selectNodesNow(ids);
          }
        } else {
          chooseGroup(
            pr.current.paths
              .filter((p) => inTree || p.visible)
              .map((p) => p.id),
            false,
          );
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          if (pathsRef.current.length) movePathBatch(pathsRef.current, '');
        } else groupSelection();
      } else if (e.ctrlKey || e.metaKey || e.altKey) return;
      else if (e.key === 'Enter') {
        if (tool === 'trace') finish();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (mergeSource) {
          setMergeSource(null);
          setStatus('已取消合并');
        } else if (drawingRef.current) {
          finish();
        } else if (proposed) {
          setProposed(null);
        } else if (selection || nodesRef.current.length) {
          setSelection(null);
          setStatus('已取消节点选择');
        } else clearSelection();
      } else if (e.key.toLowerCase() === 'p') chooseTool('trace');
      else if (e.key.toLowerCase() === 'v') chooseTool('select');
      else if (e.key.toLowerCase() === 'a') chooseTool('edit');
      else if (e.key.toLowerCase() === 'h') chooseTool('pan');
      else if (e.key.toLowerCase() === 'e' && tool === 'edit') {
        const path = pr.current.paths.find((p) => p.id === ar.current);
        const index =
          nodesRef.current.length === 1 ? nodesRef.current[0] : null;
        if (
          path &&
          !path.closed &&
          index !== null &&
          [0, path.curves.length].includes(index)
        )
          resumeSelected(index === 0 ? 'start' : 'end');
        else setStatus('请先选中一个开放端点，再按 E 续画');
      } else if (e.key.toLowerCase() === 'c' && tool === 'trace')
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
        if ((e.target as HTMLElement).closest('.outliner')) deletePaths();
        else deleteSelection();
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
      cancelGesture();
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
    setDoc({
      ...initialTraceProject,
      image: src,
      imageName: f.name,
      width: w,
      height: h,
    });
    setStatus('正在分析新底图…');
  };
  const exportFile = (format: 'svg' | 'blender' | 'json') => {
    const p = pr.current;
    if (format === 'json') {
      download(
        JSON.stringify(p, null, 2),
        'Splinelet工程.bezier.json',
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
    const out: TraceCandidate[] = [];
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
    const changed = cloneTraceValue(original);
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
  const movePathBatch = (
    ids: string[],
    groupId: string,
    targetId?: string,
    after = false,
  ) => {
    if (busyRef.current || drag.current) throw Error('请先完成当前操作');
    const next = cloneTraceValue(pr.current);
    const moved = movePaths(next, ids, groupId, targetId, after);
    if (
      moved &&
      JSON.stringify(next.paths) !== JSON.stringify(pr.current.paths)
    )
      setDoc(next);
    setStatus('已移动 ' + ids.length + ' 条路径 · Ctrl+Z 撤销');
    return { moved, pathIds: ids, groupId };
  };
  const movePath = (a: {
    pathId: string;
    groupId?: string;
    beforeId?: string;
  }) => movePathBatch([a.pathId], a.groupId || '', a.beforeId);
  const renameItem = (kind: 'path' | 'group', id: string, name: string) => {
    if (busyRef.current || drag.current) return;
    const item =
      kind === 'path'
        ? pr.current.paths.find((p) => p.id === id)
        : pr.current.groups?.find((g) => g.id === id);
    if (!item || !name.trim() || item.name === name.trim()) return;
    transact((p) => {
      const item =
        kind === 'path'
          ? p.paths.find((p) => p.id === id)
          : p.groups?.find((g) => g.id === id);
      if (item) item.name = name.trim();
    });
    setStatus('名称已更新 · Ctrl+Z 撤销');
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
    if (action === 'visibility' && !a.visible)
      selectPathsNow(
        pathsRef.current.filter(
          (id) => pr.current.paths.find((p) => p.id === id)?.visible,
        ),
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
      const path = cloneTraceValue(original);
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
      drawing: drawingRef.current
        ? { pathId: ar.current, end: drawingEndRef.current }
        : null,
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
      tool,
      selectedPaths: pathsRef.current,
      workspace,
      model: modelApi.current?.state(),
      creation: creationApi.current?.state(),
      selectedNodes: nodesRef.current,
      gesturing: !!drag.current,
      view: vr.current,
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
    set_workspace: (a: any) => {
      if (!['trace', 'faces', 'relief'].includes(a.mode))
        throw Error('mode 必须为 trace、faces 或 relief');
      finish();
      setWorkspace(a.mode);
      if (a.mode !== 'trace') setUnified(false);
      return { workspace: a.mode };
    },
    ...Object.fromEntries(
      [
        'inspect_model',
        'preview_region',
        'commit_region_preview',
        'discard_region_preview',
        'select_regions',
        'create_relief',
        'set_relief',
        'set_model_options',
        'create_part',
        'select_part',
        'delete_model_object',
        'validate_part',
        'get_relief_mesh',
        'export_model',
      ].map((name) => [
        name,
        (a: any) => {
          if (!modelApi.current) throw Error('建模工作空间未准备好');
          return modelApi.current[name](a);
        },
      ]),
    ),
    creation_inspect: () => creationApi.current.inspect(),
    creation_focus: (a: any) => creationApi.current.focus(a.objectId),
    creation_select: (a: any) => creationApi.current.select_cells(a.cellKeys),
    creation_command: (a: any) =>
      creationApi.current.command(a.action, a.args, a.revision),
    creation_view: (a: any) => {
      if (!['flat', '3d'].includes(a.view))
        throw Error('view 必须为 flat 或 3d');
      setUnified(true);
      setWorkspace('trace');
      setCreationView(a.view);
    },
    creation_export: (a: any) => creationApi.current.export(a.format, false),
    create_path: createPath,
    resume_path: (a: any) => resumePath(a.pathId, a.end),
    add_anchor: (a: any) => addAnchor(a.position, a),
    finish_path: () => {
      finish();
      return { finished: true };
    },
    close_path: (a: any) => closePath(a),
    refit_path: requestRefit,
    set_node_mode: changeNodeMode,
    manage_group: manageGroup,
    move_path: movePath,
    select_paths: (a: any) => {
      if (
        !Array.isArray(a.pathIds) ||
        a.pathIds.some(
          (id: string) => !pr.current.paths.some((p) => p.id === id),
        )
      )
        throw Error('pathIds 必须为现有路径 ID');
      chooseGroup(a.pathIds, false);
      return { selectedPaths: pathsRef.current };
    },
    move_paths: (a: any) => {
      if (!Array.isArray(a.pathIds)) throw Error('需要 pathIds');
      return movePathBatch(a.pathIds, a.groupId || '', a.targetId, !!a.after);
    },
    merge_paths: mergePaths,
    straighten_span: (a: any) => straightenSpan(a.pathId, a.curve),
    select_node: (a: any) => selectNode(a.pathId, a.nodeIndex),
    delete_node: (a: any) => deleteNode(a.pathId, a.nodeIndex),
    commit_preview: acceptPreview,
    discard_preview: () => {
      setProposed(null);
      return { discarded: true };
    },
    get_project: () => cloneTraceValue(pr.current),
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
      chooseGroup([a.id], false);
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
          filename: 'Splinelet工程.bezier.json',
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
      creationApi.current?.clear();
      fitView();
      return { paths: p.paths.length };
    },
    set_candidates_visible: (a: any) => {
      setShowCandidates(!!a.visible);
      return { visible: !!a.visible };
    },
  };
  useEffect(() => {
    (window as any).traceStudio = {
      version: '4.0',
      call: async (action: string, args: any = {}) => {
        const fn = apiRef.current[action];
        if (!fn) throw Error('未知操作 ' + action);
        if (
          drag.current &&
          !['state', 'get_project', 'inspect_geometry', 'export'].includes(
            action,
          )
        )
          throw Error('请先完成或取消当前拖动');
        return await fn(args);
      },
    };
    const context = (document as any).modelContext,
      controller = new AbortController();
    const names = [
      ...Object.keys(modelTools),
      ...Object.keys(creationTools),
      'state',
      'detect_candidates',
      'create_path',
      'resume_path',
      'add_anchor',
      'finish_path',
      'close_path',
      'commit_preview',
      'refit_path',
      'set_node_mode',
      'manage_group',
      'move_path',
      'select_paths',
      'move_paths',
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
      ...Object.fromEntries(
        Object.entries({ ...modelTools, ...creationTools }).map(([name, t]) => [
          name,
          t.properties,
        ]),
      ),
      state: {},
      select_paths: { pathIds: { type: 'array', items: { type: 'string' } } },
      move_paths: {
        pathIds: { type: 'array', items: { type: 'string' } },
        groupId: { type: 'string' },
        targetId: { type: 'string' },
        after: { type: 'boolean' },
      },
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
      resume_path: {
        pathId: { type: 'string' },
        end: { enum: ['start', 'end'] },
      },
      add_anchor: {
        position: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          required: ['x', 'y'],
        },
        mode: { enum: ['ink', 'edge', 'manual'] },
        snap: { type: 'boolean' },
      },
      finish_path: {},
      close_path: {
        mode: { enum: ['ink', 'edge', 'manual'] },
        snap: { type: 'boolean' },
      },
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
              description:
                { ...modelTools, ...creationTools }[name]?.description ||
                (
                  {
                    state:
                      'Read image dimensions, paths, tool, selection sets and fit quality.',
                    select_paths:
                      'Select multiple paths by ID and enter object selection mode; empty list deselects.',
                    move_paths:
                      'Move multiple paths to a group or before/after a target path, preserving tree order. One undo step.',
                    detect_candidates:
                      'Generate numbered image corner candidates and display on canvas. Original image pixel coordinates.',
                    create_path:
                      'Trace ordered coordinates or candidate IDs along image edges and fit exactly one cubic per adjacent pair, without inserting intermediate anchors. fitError reports when the user should add a point. preview=true stages for visual review.',
                    resume_path:
                      'Resume an existing visible open path from its start or end. Changes drawing state only; keeps existing geometry and undo history unchanged.',
                    add_anchor:
                      'Add one point at the current drawing endpoint, with exactly one new cubic. If no drawing is active, starts a new path. Original-image pixel coordinates. Undoable.',
                    finish_path:
                      'Finish the current drawing session without changing geometry.',
                    close_path:
                      'Close the active open path from the current drawing endpoint with one cubic. Undoable.',
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
                  { ...modelTools, ...creationTools }[name]?.required ||
                  (name === 'resume_path'
                    ? ['pathId', 'end']
                    : name === 'add_anchor'
                      ? ['position']
                      : ['select_paths', 'move_paths'].includes(name)
                        ? ['pathIds']
                        : name === 'move_path'
                          ? ['pathId']
                          : name === 'set_node_mode'
                            ? ['pathId', 'nodeIndex', 'mode']
                            : name === 'manage_group'
                              ? ['action']
                              : name === 'merge_paths'
                                ? [
                                    'firstId',
                                    'firstEnd',
                                    'secondId',
                                    'secondEnd',
                                  ]
                                : name === 'straighten_span'
                                  ? ['pathId']
                                  : name === 'create_path'
                                    ? ['points']
                                    : ['select_node', 'delete_node'].includes(
                                          name,
                                        )
                                      ? ['pathId', 'nodeIndex']
                                      : name === 'set_point'
                                        ? [
                                            'pathId',
                                            'curve',
                                            'point',
                                            'position',
                                          ]
                                        : name === 'export'
                                          ? ['format']
                                          : []),
                additionalProperties: false,
              },
              annotations: {
                readOnlyHint:
                  { ...modelTools, ...creationTools }[name]?.readOnly ||
                  [
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
  const legacyInspector = (
    <aside
      className="inspector"
      style={
        {
          '--inspector-width': inspectorWidth + 'px',
        } as React.CSSProperties
      }
    >
      <Outliner
        project={project}
        selected={selectedPaths}
        active={active}
        busy={busy || gesturing}
        onSelect={choosePath}
        onGroupSelect={chooseGroup}
        onClear={clearSelection}
        onNew={begin}
        onGroup={groupSelection}
        onRename={renameItem}
        onMove={(...args) => {
          try {
            movePathBatch(...args);
          } catch (e: any) {
            setStatus(e.message);
          }
        }}
        onVisibility={setVisible}
        onDissolve={(id) => manageGroup({ action: 'delete', id })}
        onDelete={deletePaths}
        onEdit={() => chooseTool('edit')}
      />
      <div className="properties-area">
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
            <h3>
              {selectedNodes.length
                ? '已选 ' + selectedNodes.length + ' 个节点'
                : '节点属性'}
            </h3>
            <p>{current?.name || '选择一条路径后进入节点编辑'}</p>
            {current && current.visible && tool === 'edit' ? (
              <SplineNodeInspector
                path={current}
                nodes={selectedNodes}
                selection={selection}
                disabled={busy || gesturing}
                merging={!!mergeSource}
                canMerge={project.paths.some(
                  (p) =>
                    p.id !== current.id &&
                    p.visible &&
                    !p.closed &&
                    p.curves.length,
                )}
                onResume={resumeSelected}
                onMode={(mode) => {
                  try {
                    transact((p) => {
                      const path = p.paths.find((p) => p.id === current.id)!;
                      selectedNodes.forEach((i) =>
                        setContinuity(path, i, mode),
                      );
                    });
                    setStatus(
                      '已更新 ' +
                        selectedNodes.length +
                        ' 个节点的连接方式 · 可撤销',
                    );
                  } catch (e: any) {
                    setStatus(e.message);
                  }
                }}
                onStraighten={(curve) => {
                  try {
                    straightenSpan(current.id, curve);
                  } catch (e: any) {
                    setStatus(e.message);
                  }
                }}
                onMerge={startMerge}
                onCancelMerge={() => setMergeSource(null)}
                onDelete={deleteSelection}
                onClear={() => setSelection(null)}
              />
            ) : (
              <div className="empty-properties">
                <p>
                  {current && !current.visible
                    ? '当前路径已隐藏，显示后可编辑节点。'
                    : '先选择路径，再编辑它的节点与控制柄。'}
                </p>
                <button
                  onClick={() => {
                    if (current && !current.visible)
                      setVisible([current.id], true);
                    chooseTool(current ? 'edit' : 'select');
                  }}
                >
                  {current && !current.visible
                    ? '显示并编辑节点'
                    : current
                      ? '编辑当前路径节点'
                      : '选择路径'}
                </button>
              </div>
            )}
          </section>
        </div>
        <div
          role="tabpanel"
          aria-label="描线参数"
          hidden={propertyTab !== 'trace'}
        >
          <SplineTraceControls
            path={selectedPaths.length === 1 ? current : undefined}
            drawing={drawing}
            end={drawingEnd}
            disabled={busy || !ready || gesturing}
            onResume={resumeSelected}
            onFinish={finish}
            onClose={(e) =>
              report(closePath(connectionSettings(sr.current, e)))
            }
          />
          <details className="spline-fitting-settings" open>
            <summary>拟合与吸附</summary>
            <section>
              <p>
                每两个落点仅生成一段贝塞尔。算法只调整两个控制柄，不自动增加中间锚点。
              </p>
              <label>识别目标</label>
              <Tabs
                value={settings.mode}
                onValueChange={(v) => {
                  setSettings((s) => ({
                    ...s,
                    mode: v as TraceSettings['mode'],
                  }));
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
            </section>
          </details>
        </div>
        <div
          role="tabpanel"
          aria-label="路径与分组"
          hidden={propertyTab !== 'paths'}
        >
          <SplinePathInspector
            path={
              !unified || creationSelectionKind === 'path' ? current : undefined
            }
            count={
              !unified || creationSelectionKind === 'path'
                ? selectedPaths.length
                : 0
            }
            disabled={busy || gesturing}
            canRefit={ready && !!current && current.anchors.length >= 2}
            onEdit={() => chooseTool('edit')}
            onResume={resumeSelected}
            onGroup={groupSelection}
            onDelete={deletePaths}
            onClear={clearSelection}
            onRefit={() => requestRefit()}
          />
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
      </div>
    </aside>
  );
  return (
    <main
      className={'studio ' + (unified ? 'creation-studio' : '')}
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
          <b>Splinelet</b>
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
          <details className="compact-menu">
            <summary>更多</summary>
            <div>
              <button
                onClick={(e) => {
                  e.currentTarget.closest('details')?.removeAttribute('open');
                  void openProjectFile();
                }}
              >
                <FolderOpen size={15} />
                打开工程
              </button>
              <button
                onClick={(e) => {
                  e.currentTarget.closest('details')?.removeAttribute('open');
                  setDialog('help');
                }}
              >
                <HelpCircle size={15} />
                操作帮助
              </button>
              <button
                onClick={(e) => {
                  e.currentTarget.closest('details')?.removeAttribute('open');
                  setDialog('api');
                }}
              >
                <Code2 size={15} />
                Agent API
              </button>
            </div>
          </details>
          <button
            className="primary"
            onClick={() =>
              workspace === 'trace'
                ? unified
                  ? creationApi.current?.show_output()
                  : setDialog('export')
                : modelApi.current?.show_output()
            }
          >
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
      <nav
        className="workspace-switch creation-workspace-switch"
        aria-label="工作空间"
      >
        <button
          aria-pressed={workspace === 'trace' && creationView === 'flat'}
          onClick={() => {
            finish();
            setWorkspace('trace');
            setUnified(true);
            setCreationView('flat');
          }}
        >
          平面创作
        </button>
        <button
          aria-pressed={workspace === 'trace' && creationView === '3d'}
          onClick={() => {
            finish();
            setWorkspace('trace');
            setUnified(true);
            setCreationView('3d');
            chooseTool('select');
          }}
        >
          <Box size={16} />
          立体预览
        </button>
        <span>
          {workspace !== 'trace'
            ? '高级构造记录 · 保留来源与依赖'
            : creationView === '3d'
              ? '同一个部件 · 直接选择区域调整颜色和高低'
              : '描边界 · 填颜色 · 调高低'}
        </span>
        {workspace !== 'trace' && (
          <button
            onClick={() => {
              setWorkspace('trace');
              setUnified(true);
            }}
          >
            返回创作
          </button>
        )}
        <details className="creation-mode-menu">
          <summary>更多</summary>
          <div>
            <button
              onClick={() => {
                finish();
                setUnified(false);
                setWorkspace('trace');
              }}
            >
              源线工作台
            </button>
            <button
              onClick={() => {
                finish();
                setWorkspace('faces');
              }}
            >
              构面
            </button>
            <button
              onClick={() => {
                finish();
                setWorkspace('relief');
              }}
            >
              浮雕
            </button>
          </div>
        </details>
      </nav>
      <div
        className="workspace"
        style={{ display: workspace === 'trace' ? 'flex' : 'none' }}
      >
        <nav className="toolrail" aria-label="绘图工具">
          {[
            [MousePointer2, 'select', '选择', 'V'],
            [Spline, 'edit', '节点', 'A'],
            [PenTool, 'trace', '描线', 'P'],
            ...(unified
              ? [
                  [PaintBucket, 'paint', '上色', ''],
                  [ArrowUpFromLine, 'height', '高低', ''],
                ]
              : []),
            [Hand, 'pan', '平移', 'H'],
          ].map(([Icon, value, label, key]: any) => (
            <button
              key={value}
              title={key ? `${label} (${key})` : label}
              aria-label={key ? `${label} (${key})` : label}
              className={tool === value ? 'selected' : ''}
              aria-pressed={tool === value}
              onClick={() => chooseTool(value)}
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
          tabIndex={0}
          aria-label="编辑画布"
          className={`stage tool-${tool} ${unified ? 'creation-stage' : ''} ${creationView === '3d' && unified ? 'creation-is-3d' : ''}`}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={() => cancelGesture()}
          onPointerLeave={() => {
            if (!drag.current) {
              setPreview([]);
              previewToken.current++;
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (drag.current) cancelGesture();
            else if (tool === 'trace') finish();
            else if (mergeSource) setMergeSource(null);
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
                    : tool === 'pan'
                      ? '空格 / 中键拖动画布 · 滚轮缩放'
                      : tool === 'select'
                        ? '路径选择'
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
              <g ref={setCreationLayer} />
              {project.paths
                .filter(
                  (p) =>
                    p.visible &&
                    (!unified ||
                      !project.creation?.objects.some(
                        (o: any) => o.pathIds.includes(p.id) && !o.visible,
                      )),
                )
                .map((path) => (
                  <g
                    key={path.id}
                    data-source-id={path.id}
                    className={
                      'source-path-layer' +
                      (highlightSourceSelection &&
                      selectedPaths.includes(path.id)
                        ? ' selected'
                        : '')
                    }
                  >
                    {!path.curves.length && (
                      <circle
                        cx={path.start.x}
                        cy={path.start.y}
                        r={5 / view.s}
                        fill={path.color}
                        onPointerDown={(e) => startPathDrag(e, path.id)}
                        onDoubleClick={() => {
                          setActiveNow(path.id);
                          chooseTool('edit');
                        }}
                      />
                    )}
                    <path
                      d={d(path.curves) + (path.closed ? ' Z' : '')}
                      fill={fill && path.closed ? path.color + '24' : 'none'}
                      stroke={path.color}
                      strokeWidth={
                        (highlightSourceSelection &&
                        selectedPaths.includes(path.id)
                          ? 2.8
                          : 1.5) / view.s
                      }
                      opacity={
                        highlightSourceSelection &&
                        selectedPaths.length &&
                        !selectedPaths.includes(path.id)
                          ? 0.55
                          : 1
                      }
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      aria-label={path.name}
                      d={d(path.curves) + (path.closed ? ' Z' : '')}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={
                        (unified && tool === 'select' ? 3 : 14) / view.s
                      }
                      style={{
                        pointerEvents: ['edit', 'select'].includes(tool)
                          ? 'stroke'
                          : 'none',
                      }}
                      onPointerDown={(e) => startPathDrag(e, path.id)}
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
                              const node =
                                selectedNodes.length === 1
                                  ? selectedNode(current, selection)
                                  : null;
                              return node !== null
                                ? (k === 1
                                    ? i
                                    : current.closed
                                      ? (i + 1) % current.curves.length
                                      : i + 1) === node
                                : !selectedNodes.length &&
                                    selection?.curve === i;
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
                        const selected = selectedNodes.includes(index);
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
                            {!current.closed &&
                              [0, current.curves.length].includes(index) && (
                                <text
                                  x={p.x + 10 / view.s}
                                  y={p.y - 12 / view.s}
                                  fontSize={11 / view.s}
                                  fill="#e5ffc5"
                                  paintOrder="stroke"
                                  stroke="#162321"
                                  strokeWidth={3 / view.s}
                                  pointerEvents="none"
                                >
                                  {index === 0 ? '头' : '尾'}
                                </text>
                              )}
                          </g>
                        );
                      })}
                    </>
                  ) : tool === 'trace' ||
                    (tool === 'select' &&
                      selectedPaths.length === 1 &&
                      (!unified || creationSelectionKind === 'path')) ? (
                    <>
                      {tool === 'trace' &&
                        current.anchors
                          .slice(1, -1)
                          .map((p, i) => (
                            <circle
                              key={i}
                              cx={p.x}
                              cy={p.y}
                              r={3 / view.s}
                              fill={current.color}
                              pointerEvents="none"
                            />
                          ))}
                      <SplineEndpoints
                        path={current}
                        scale={view.s}
                        drawing={tool === 'trace' && drawing}
                        end={drawingEnd}
                        disabled={busy || !ready}
                        isPanning={() => space.current}
                        onResume={resumeSelected}
                        onClose={(e) =>
                          report(closePath(connectionSettings(sr.current, e)))
                        }
                      />
                    </>
                  ) : null}
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
                tool === 'trace' &&
                candidates.map((c) => (
                  <g
                    key={c.id}
                    transform={`translate(${c.x},${c.y}) scale(${1 / view.s})`}
                    className="candidate"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (ready && !busy && tool === 'trace')
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
            {marquee && (
              <rect
                data-selection-box="true"
                x={view.x + marquee.x * view.s}
                y={view.y + marquee.y * view.s}
                width={marquee.width * view.s}
                height={marquee.height * view.s}
                fill="#b8ef6220"
                stroke="#b8ef62"
                strokeWidth={1}
                strokeDasharray="5 3"
                pointerEvents="none"
              />
            )}
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
                      : 'Shift 多选节点 · 空白拖动框选 · Del 删除 · Esc 取消'
                    : tool === 'select'
                      ? '单击选择 · Shift 多选 · 空白拖动框选 · 双击曲线编辑节点'
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
        <>
          <CreationWorkspace
            project={project}
            enabled={unified && workspace === 'trace'}
            viewMode={creationView}
            tool={tool}
            onTool={chooseTool}
            onView={setCreationView}
            onProject={setDoc}
            onStatus={setStatus}
            onApi={(api) => {
              creationApi.current = api;
            }}
            layer={creationLayer}
            stage={stage.current}
            scale={view.s}
            width={inspectorWidth}
            selectedPaths={selectedPaths}
            onSelectPaths={(ids) => selectPathsNow(ids)}
            onSelectionKind={setCreationSelectionKind}
            onFramePaths={framePaths}
            onStartDrag={startPathDrag}
            onCanvasPointerDown={pointerDown}
            sourceInspector={legacyInspector}
            onAdvanced={(mode) => {
              finish();
              setWorkspace(mode);
            }}
            onNewPath={begin}
            busy={busy || gesturing}
            opacity={opacity}
            onOpacity={setOpacity}
          />
          {!unified && legacyInspector}
        </>
      </div>
      <ModelWorkspace
        project={project}
        mode={workspace}
        initialPaths={selectedPaths}
        onModel={(model) =>
          transact((p) => {
            p.version = p.creation ? 3 : 2;
            p.model = model;
          })
        }
        onEditSource={(id) => {
          setWorkspace('trace');
          setActiveNow(id);
          chooseTool('edit');
        }}
        onApi={(api) => {
          modelApi.current = api;
        }}
        onMode={setWorkspace}
        onUndo={undo}
        onRedo={redo}
        status={setStatus}
      />
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
                统一创作：creation_inspect、creation_focus、creation_select、creation_command、creation_view、creation_export。
                填色和厚度命令须带最新 creation_inspect 返回的 revision。
              </p>
              <p>
                描线操作：state、detect_candidates、create_path、resume_path、add_anchor、finish_path、close_path、commit_preview、discard_preview、get_project、select_path、select_node、delete_node、merge_paths、straighten_span、refit_path、set_node_mode、manage_group、set_point、set_view、undo、inspect_geometry、export、load_project。
              </p>
              <p>
                构面 /
                浮雕操作：preview_region、commit_region_preview、inspect_model、select_regions、create_relief、set_relief、set_model_options、create_part、select_part、validate_part、get_relief_mesh、export_model。几何坐标以毫米为单位，源路径仍是图像像素。支持
                WebMCP 的浏览器会注册 bezier_ 前缀工具。本地配套 HTTP
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
                <b>构面 → 浮雕</b>
                　构面选择来源和操作，先预览，再点击候选区域并确认。闭合路径可建面，开放样条可分区、围面或加宽；区域支持并集、相减和交集。橙色连接只用于派生区域。
              </p>
              <p>
                <b>体块与零件</b>
                　选择面后添加体块，设置厚度和高度基准。凸起先合并，凹槽和贯穿随后切除；不同零件独立计算。制造
                / 导出提供实体检查、STL、Blender 和面
                SVG。所有来源和建模操作一起保存，可撤销。
              </p>
              <p>
                <b>选择路径 · V</b>　单击曲线选择，Shift / Ctrl
                单击增减选择；空白拖动框选相交曲线，按住 Shift
                追加。拖动已选曲线移动整个选择集。双击曲线进入节点编辑。
              </p>
              <p>
                <b>编辑节点 · A</b>　编辑当前一条路径。Shift / Ctrl
                单击增减节点，空白拖动框选；Ctrl+A
                选择当前路径所有节点。拖动选中节点一起移动，单选时显示控制柄。双击曲线插入节点，Delete
                删除所选节点。
              </p>
              <p>
                <b>作品树</b>　单击选择，Ctrl 增减，Shift 连选，仅箭头展开。
                双击部件或线条名称改名。拖动部件调整列表顺序，拖动线条移入部件；
                物理高度在“位置与叠放”中设置。
              </p>
              <p>
                <b>填色与高低</b>　选中部件后画轮廓、分区线或挖洞线。
                底部选色，上色工具点击或按住扫过区域；右侧切换局部与整个对象，输入厚度或拖动调高。
                平面与立体保留同一选择。项目色可双击编辑，引用它的区域一起改变。
                制作标签中预览底板、检查实体并导出。
              </p>
              <p>
                <b>高级源线路径树</b>　单击名称选择，Ctrl 增减，Shift
                连续选择；上下键移动选择，F2 或双击名称改名。Enter
                编辑节点。拖动所选路径批量移组；行上半部插到前面，下半部插到后面，拖到组名移到组尾。仅箭头控制折叠。Ctrl+G
                编组，Ctrl+Shift+G 移出分组。
              </p>
              <p>
                <b>描线 · P</b>　每两个落点只有一段贝塞尔。Shift 暂停吸附，Alt
                默认直连；L 将最后一段改为直连。Enter / 右键结束，C
                闭合。开放路径可选“从头续画 /
                从尾续画”，也可双击端点或选中端点按 E。
              </p>
              <p>
                <b>精修与合并</b>
                　节点属性设置尖角、平滑或对称。节点模式单选开放端点，按 M
                后点击另一条样条端点合并。L
                直连选中节点对应的一段。高级重拟合会二次确认。
              </p>
              <p>
                <b>取消与恢复</b>　拖动中 Shift 限制水平或垂直方向，Esc
                恢复拖动前位置。空白单击清除当前层级选择；Esc
                依次取消当前操作、节点选择、路径选择。一次拖动、批量移组或删除均可用
                Ctrl+Z 一步撤销，Ctrl+Shift+Z 重做。
              </p>
              <p>
                <b>视图与保存</b>
                　滚轮缩放；空格拖动或中键平移；右侧边界调整宽度，不重置缩放。工程自动备份，Ctrl+S
                绑定并写回同一文件，Ctrl+Shift+S 另存为。制作标签导出分色 SVG、
                打印 STL 和 Blender 实体与源线；精确贝塞尔 SVG
                在源线工作台导出。
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
