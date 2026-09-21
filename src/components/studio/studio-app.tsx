'use client';
import { parseSvgImport, type SvgImportResult } from '@/lib/import/svg-import';
import VectorImportDialog from './vector-import-dialog';
import type { ObjectTransformMode } from '@/components/creation/object-transform-controls';
import type { ObjectTransformDelta } from '@/lib/source-editor/object-transform-preview';
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useEffectEvent,
  type ComponentProps,
} from 'react';
import {
  PenTool,
  MousePointer2,
  Move,
  Download,
  Spline,
  Plus,
  Scan,
  Undo2,
  Redo2,
  Check,
  Target,
  Save,
  Minus,
  PaintBucket,
  ArrowUpFromLine,
  Box,
} from 'lucide-react';
import StudioFileMenu from '@/components/studio/studio-file-menu';
import NumberEdit from '@/components/shared/creation-number';
import { modelTools } from '@/lib/model-api';
import ModelWorkspace from '@/components/modeling/model-workspace';
import CreationWorkspace from '@/components/creation/creation-workspace';
import { DesktopWindowControls } from '@/components/shell/desktop-window-controls';
import {
  SplinePathInspector,
  SplineNodeInspector,
  SplineTraceControls,
} from '@/components/source-editor/spline-inspector';
import {
  SourceNodeHandles,
  SourcePathLayers,
} from '@/components/source-editor/source-canvas-layers';
import { splineEndpoint } from '@/lib/source-editor/extend.mjs';
import SplineEndpoints from '@/components/source-editor/spline-endpoints';
import EndpointSnapOverlay, {
  type EndpointSnapFeedback,
} from '@/components/source-editor/endpoint-snap-overlay';
import {
  cloneTraceValue,
  type TraceCandidate,
  type TraceSettings,
} from '@/components/source-editor/trace-editor-state';
import { creationTools } from '@/lib/creation-api';
import { splineTools } from '@/lib/spline-api';
import { createStudioAgentTools } from '@/lib/agent/tool-catalog';
import { agentJSONValue } from '@/lib/agent/transport.mjs';
import { inspectSplines } from '@/lib/source-editor/spline-edit.mjs';
import type {
  AgentCreationCommandArgs,
  AgentCreationExportArgs,
  AgentCreationFocusArgs,
  AgentCreationSelectArgs,
  AgentCreationViewArgs,
  AgentExportArgs,
  AgentGroupArgs,
  AgentLoadProjectArgs,
  AgentMergeArgs,
  AgentMovePathsArgs,
  AgentNodeArgs,
  AgentPathEndArgs,
  AgentPathListArgs,
  AgentPointArgs,
  AgentSpanArgs,
  AgentViewArgs,
  AgentVisibilityArgs,
  AgentWorkspaceArgs,
} from '@/hooks/trace-agent-contract';
import {
  pickSelection,
  inBox,
  pathHitsBox,
} from '@/lib/source-editor/selection.mjs';
import {
  screenToDocument,
  zoomAt,
  framePathsView,
} from '@/lib/source-editor/canvas-gestures.mjs';
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
} from '@/lib/project';
import { SPL_MIME } from '@/lib/project-format.mjs';
import {
  desktopPendingOpenPaths,
  desktopProjectOpenPath,
  desktopProjectSavePath,
  desktopReadFile,
  isDesktopRuntime,
  listenDesktopOpenFiles,
} from '@/lib/platform/index.mjs';
import { evaluate, dist, inspectGeometry } from '../../../public/geometry.mjs';
import {
  pathNodes,
  nodeSelection,
  selectedNode,
} from '@/lib/source-editor/node-edit.mjs';
import {
  connectionSettings,
  straightCubic,
  mergeSplines,
} from '@/lib/source-editor/connect.mjs';
import { createV4NodeActions } from '@/lib/source-editor/node-actions.mjs';
import { useStudioProject, type StudioHost } from '@/hooks/use-studio-project';
import { useSourceDrag } from '@/hooks/use-source-drag';
import { openProject } from '@/lib/persistence/open-project.mjs';
import { readAgentProjectInput } from '@/lib/persistence/agent-project-input.mjs';
import { encodeDocument } from '@/lib/document/codec.mjs';
import { createReferenceProject } from '@/lib/editor/new-reference-project.mjs';

type ModelApi = {
  state: (input?: unknown) => unknown;
  [action: string]: (input?: unknown) => unknown;
};
type CreationApi = Parameters<
  ComponentProps<typeof CreationWorkspace>['onApi']
>[0];
type CandidatePoint = Omit<TraceCandidate, 'id'>;
type RpcRequest = Record<string, unknown>;
type TraceResponse = {
  end: Point;
  curves: Point[][];
  quality: number;
  fitError: number;
};
type SnapResponse = { point: Point };
type DetectCandidatesArgs = {
  limit?: number;
  spacing?: number;
  region?: { x: number; y: number; width: number; height: number };
};
type ImageInitResponse = { candidates: CandidatePoint[] };
type ProjectBinding =
  | { kind: 'web'; handle: ProjectFileHandle; name: string }
  | { kind: 'desktop'; path: string; name: string };
type ProjectFileHandle = {
  name: string;
  queryPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission: (options: {
    mode: 'readwrite';
  }) => Promise<PermissionState>;
  getFile: () => Promise<File>;
};
type FilePickerWindow = Window &
  typeof globalThis & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<ProjectFileHandle>;
    showOpenFilePicker?: (options: {
      multiple: boolean;
      types: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<ProjectFileHandle[]>;
  };
type AgentHandler = { invoke(args?: unknown): unknown }['invoke'];
type TraceApi = Record<string, AgentHandler>;
const studioAgentTools = createStudioAgentTools({
  modelTools,
  creationTools,
  splineTools,
});
type TraceStudioWindow = Window &
  typeof globalThis & {
    traceStudio?: {
      version: string;
      call: (action: string, args?: unknown) => Promise<unknown>;
    };
  };
type DragGesture =
  | {
      kind: 'pan';
      pointerId: number;
      button: number;
      x: number;
      y: number;
      view: { x: number; y: number; s: number };
      moved?: boolean;
    }
  | {
      kind: 'box';
      pointerId: number;
      button: number;
      x: number;
      y: number;
      origin: Point;
      add: boolean;
      oldPaths: string[];
      oldNodes: number[];
      moved?: boolean;
      rect?: { x: number; y: number; width: number; height: number };
    };
type GeometryReportItem = {
  name: string;
  gaps: number;
  selfIntersections: unknown[];
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const currentTime = () => performance.now();
const projectNameFromPath = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).at(-1) || '工程.spl';
export default function StudioApp({ host }: { host: StudioHost }) {
  if (!host) throw Error('编辑器必须通过 V4 工程宿主启动');
  const [workspace, setWorkspace] = useState('trace');
  const modelApi = useRef<ModelApi>(null);
  const creationApi = useRef<CreationApi>(null);
  const traceTarget = useRef<ReturnType<
    NonNullable<CreationApi>['trace_target']
  > | null>(null);

  const [creationView, setCreationView] = useState('flat');
  const [creationSelectionKind, setCreationSelectionKind] = useState<
    'object' | 'path' | 'cell'
  >('object');
  const highlightSourceSelection = creationSelectionKind !== 'cell';
  const creationViewRef = useRef('flat');
  const [creationLayer, setCreationLayer] = useState<SVGGElement | null>(null);
  const { project, snapshot: studioSnapshot } = useStudioProject(host);
  const pr = useRef(project);
  useLayoutEffect(() => {
    pr.current = project;
  }, [host, project]);
  const [active, setActive] = useState<string | null>(null),
    ar = useRef(active);
  const [tool, setTool] = useState('select'),
    [drawing, setDrawing] = useState(false),
    drawingRef = useRef(false);
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
  const [readyImage, setReadyImage] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    busyRef = useRef(false),
    [status, setStatus] = useState('正在分析底图…');
  // A newly opened document must never inherit the previous image worker's
  // readiness while its initialization effect is still pending.
  const ready = readyImage !== null && readyImage === project.image;
  const [preview, setPreview] = useState<Cubic[]>([]),
    [proposed, setProposed] = useState<TracePath | null>(null),
    [opacity, setOpacity] = useState(85),
    [vectorsOnly, setVectorsOnly] = useState(false),
    [fill, setFill] = useState(false);
  const proposedCommit = useRef<{ id: string; commit: () => TracePath } | null>(
    null,
  );
  useEffect(() => {
    if (!proposed) proposedCommit.current = null;
  }, [proposed]);
  const [candidates, setCandidates] = useState<TraceCandidate[]>([]),
    cr = useRef(candidates);
  const allCandidates = useRef<CandidatePoint[]>([]);
  const [showCandidates, setShowCandidates] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, s: 0.5 }),
    vr = useRef(view);
  const movePathBatchRef =
    useRef<
      (
        ids: string[],
        groupId: string,
        targetId?: string,
        after?: boolean,
      ) => unknown
    >(null);
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const setStage = useCallback((element: HTMLDivElement | null) => {
    stage.current = element;
    if (element) element.tabIndex = 0;
    setStageElement((current) => (current === element ? current : element));
  }, []);
  useEffect(() => {
    creationViewRef.current = creationView;
    ar.current = active;
    drawingRef.current = drawing;
    sr.current = settings;
    cr.current = candidates;
    vr.current = view;
  }, [active, candidates, creationView, drawing, settings, view]);
  const stage = useRef<HTMLDivElement>(null),
    worker = useRef<Worker | null>(null),
    scale = useRef(1),
    seq = useRef(0),
    requests = useRef(
      new Map<
        number,
        { resolve: (value: unknown) => void; reject: (error: Error) => void }
      >(),
    );
  const [dialog, setDialog] = useState<'export' | 'help' | 'api' | null>(null);
  const initialized = true;
  const historySize = Number(studioSnapshot.editorState.canUndo);
  const futureSize = Number(studioSnapshot.editorState.canRedo);
  const saved = studioSnapshot.storage.dirty ? '有修改未保存' : '已保存';
  const vectorFile = useRef<HTMLInputElement>(null);
  const pendingVectorFocus = useRef<string | null>(null);
  const [vectorInput, setVectorInput] = useState<
    (SvgImportResult & { name: string; project: Project }) | null
  >(null);
  const importVector = async (file: File) => {
    if (busyRef.current || fileBusyRef.current || studioDrag.isActive())
      throw Error('请先完成当前操作');
    if (file.size > 5 * 1024 * 1024) throw Error('SVG 文件不能超过 5 MB');
    const captured = host.getSnapshot().project;
    const parsed = parseSvgImport(await file.text());
    if (host.getSnapshot().project !== captured)
      throw Error('工程已变化，请重新导入');
    setVectorInput({
      ...parsed,
      name: file.name.replace(/\.svg$/i, ''),
      project: captured as Project,
    });
  };
  const file = useRef<HTMLInputElement>(null),
    projectFile = useRef<HTMLInputElement>(null),
    space = useRef(false),
    [isSpaceDown, setIsSpaceDown] = useState(false),
    drag = useRef<DragGesture | null>(null),
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
  const [mergeTarget, setMergeTarget] = useState<{
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
  const propertyTab =
    tool === 'edit' ? 'node' : tool === 'trace' ? 'trace' : 'paths';
  const [inspectorWidth, setInspectorWidth] = useState(320);
  const inspectorResizeDrag = useRef<{ x: number; width: number } | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]),
    pathsRef = useRef<string[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<number[]>([]),
    nodesRef = useRef<number[]>([]);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [gesturing, setGesturing] = useState(false);
  const [transformMode, setTransformMode] =
    useState<ObjectTransformMode>('translate');
  const [objectMoveCommit, setObjectMoveCommit] = useState<{
    project: Project;
    nodeIds: string[];
    delta: ObjectTransformDelta;
  } | null>(null);
  const [nodeSnap, setNodeSnap] = useState(true),
    [keepSeams, setKeepSeams] = useState(true),
    [snapFeedback, setSnapFeedback] = useState<EndpointSnapFeedback | null>(
      null,
    );
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
    studioDrag.cancel();
    if (['trace', 'edit', 'move'].includes(next)) setCreationView('flat');
    if (drag.current) cancelGesture();
    if (next !== 'trace') finish();
    setTool(next);
    if (next === 'edit') {
      if (pathsRef.current.length > 1)
        selectPathsNow(ar.current ? [ar.current] : []);
      creationApi.current?.select_paths(ar.current ? [ar.current] : []);
    }
    if (next === 'select') {
      setSelection(null);
    }
    if (next === 'move') {
      setSelection(null);
    }
    if (['trace', 'edit', 'move'].includes(next))
      creationApi.current?.show_tool();
    stage.current?.focus({ preventScroll: true });
    setStatus(
      next === 'select'
        ? '选择 · 点击面或线 · 空白框选线条 · 按 A 编辑节点'
        : next === 'edit'
          ? '编辑节点 · Shift 多选 · 空白拖动框选'
          : next === 'trace'
            ? '点击轮廓落点 · Shift 不吸附 · Alt 直连'
            : next === 'paint'
              ? '点击上色 · 平面中按住扫过多个区域 · 一笔一次撤销'
              : next === 'height'
                ? '选择局部或整个部件 · 拖动高度柄或输入毫米数值'
                : next === 'move'
                  ? '变换对象 · 在工具属性选择移动、旋转或缩放 · 右键平移视图'
                  : '右键、空格或中键拖动平移视图',
    );
  };
  const clearSelection = () => {
    creationApi.current?.clear();
    finish();
    setSelection(null);
    selectPathsNow([]);
    setStatus('已取消选择');
  };
  const chooseGroup = (ids: string[], add: boolean) => {
    if (busyRef.current || drag.current) return;
    finish();
    setTool('select');
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
        ? '已选 ' + pathsRef.current.length + ' 条路径 · 按 A 编辑节点或编组'
        : '已取消选择',
    );
  };
  const setVisible = (ids: string[], visible: boolean) => {
    if (busyRef.current || drag.current) return;
    {
      const captured = host.getSnapshot();
      pr.current = captured.runtime
        .commandPath(
          { kind: 'set-paths', pathIds: ids, value: { visible } },
          { project: captured.project },
        )
        .commit();
    }
    if (!visible)
      selectPathsNow(pathsRef.current.filter((id) => !ids.includes(id)));
    setStatus(visible ? '已显示路径 · 可撤销' : '已隐藏路径 · 可撤销');
  };
  const commitGroup = (request: Record<string, unknown>) => {
    const captured = host.getSnapshot();
    const next = captured.runtime
      .commandGroup(request, { project: captured.project })
      .commit() as Project;
    pr.current = next;
    return next;
  };
  const groupSelection = () => {
    if (busyRef.current || drag.current) return;
    const ids = pathsRef.current;
    {
      try {
        commitGroup({
          kind: 'create-group',
          name: '分组 ' + ((pr.current.groups?.length || 0) + 1),
          pathIds: ids,
        });
      } catch (error) {
        setStatus(errorMessage(error));
        return;
      }
    }
    setStatus(
      ids.length
        ? '已将 ' + ids.length + ' 条路径编组 · Ctrl+Z 撤销'
        : '已创建空分组 · 拖入路径',
    );
  };
  const deletePaths = () => {
    if (busyRef.current || drag.current || !pathsRef.current.length) return;
    const ids = pathsRef.current;
    {
      const captured = host.getSnapshot();
      pr.current = captured.runtime
        .commandPath(
          { kind: 'delete-paths', pathIds: ids },
          { project: captured.project },
        )
        .commit();
    }
    clearSelection();
    setStatus('已删除 ' + ids.length + ' 条路径 · Ctrl+Z 撤销');
  };
  const clampInspector = (width: number) =>
    Math.max(240, Math.min(600, window.innerWidth - 280, width));
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const width = Number(localStorage.getItem('bezier-inspector-width'));
        if (width >= 240) setInspectorWidth(clampInspector(width));
      } catch {}
    });
    return () => clearTimeout(timer);
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
  const displayedFileName =
    studioSnapshot.storage.target?.kind === 'web'
      ? studioSnapshot.storage.target.handle.name
      : studioSnapshot.storage.target?.kind === 'desktop'
        ? projectNameFromPath(studioSnapshot.storage.target.path)
        : studioSnapshot.presentation.fileName || '';
  const [fileBusy, setFileBusy] = useState(false);
  const fileBusyRef = useRef(false);
  const saveProject = async (saveAs = false) => {
    {
      if (fileBusyRef.current) return;
      const before = host.getSnapshot();
      if (before.editorState.previewId) {
        setStatus('请先完成或取消拖动，再保存工程');
        return;
      }
      fileBusyRef.current = true;
      setFileBusy(true);
      try {
        let target = saveAs ? null : before.storage.target;
        const suggestedName =
          before.presentation.fileName || 'Splinelet工程.spl';
        if (!target && isDesktopRuntime()) {
          const path = await desktopProjectSavePath(suggestedName);
          if (!path) return;
          target = { kind: 'desktop', path };
        } else if (!target) {
          const pickerWindow = window as FilePickerWindow;
          if (!pickerWindow.showSaveFilePicker) {
            download(
              encodeDocument(before.storage.document, {
                assets: before.storage.assets,
              }),
              suggestedName,
              SPL_MIME,
            );
            setStatus('已下载工程副本 · 浏览器草稿仍用于恢复');
            return;
          }
          const handle = await pickerWindow.showSaveFilePicker({
            suggestedName,
            types: [
              {
                description: 'Splinelet工程',
                accept: { [SPL_MIME]: ['.spl'] },
              },
            ],
          });
          target = { kind: 'web', handle };
        }
        if (host.getSnapshot().editorState.epoch !== before.editorState.epoch)
          throw Error('选择保存位置期间工程已切换，请重新保存');
        await host.save(target);
        setStatus('工程已保存');
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setStatus(errorMessage(error));
      } finally {
        fileBusyRef.current = false;
        setFileBusy(false);
      }
      return;
    }
  };
  const loadProjectFile = async (
    bytes: Uint8Array | string,
    name: string,
    binding: ProjectBinding | null,
  ) => {
    {
      if (
        busyRef.current ||
        fileBusyRef.current ||
        host.getSnapshot().editorState.previewId
      )
        throw Error('请先完成当前编辑或保存，再打开工程');
      const opened = openProject({
        bytes,
        target:
          binding?.kind === 'desktop'
            ? { kind: 'desktop', path: binding.path }
            : binding?.kind === 'web'
              ? { kind: 'web', handle: binding.handle }
              : null,
      });
      const next = host.open(opened, {
        fileName: name,
        blenderExtrusionMM: host.getSnapshot().presentation.blenderExtrusionMM,
        ...(Object.keys(opened.document.references).length === 0
          ? { frame: host.getSnapshot().presentation.frame }
          : {}),
      });
      pr.current = next.project as Project;
      finish();
      setProposed(null);
      setPendingRefit(null);
      setActiveNow(null);
      creationApi.current?.clear();
      setSelection(null);
      fitView();
      setStatus(
        opened.kind === 'legacy'
          ? '旧工程已导入 · 保存时将创建 V4 工程副本'
          : binding
            ? '已打开原文件 · 修改后 Ctrl+S 保存到同一文件'
            : '已打开工程副本 · Ctrl+S 选择保存位置',
      );
      return { paths: next.project.paths.length };
    }
  };
  const openProjectFile = async () => {
    if (busyRef.current || fileBusyRef.current) return;
    if (isDesktopRuntime()) {
      try {
        const path = await desktopProjectOpenPath();
        if (!path) return;
        const legacy = !path.toLowerCase().endsWith('.spl');
        await loadProjectFile(
          await desktopReadFile(path),
          projectNameFromPath(path),
          legacy
            ? null
            : { kind: 'desktop', path, name: projectNameFromPath(path) },
        );
      } catch (error: unknown) {
        setStatus('打开工程失败：' + errorMessage(error));
      }
      return;
    }
    const pickerWindow = window as FilePickerWindow;
    if (!pickerWindow.showOpenFilePicker) {
      projectFile.current?.click();
      return;
    }
    try {
      const [handle] = await pickerWindow.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Splinelet工程',
            accept: {
              [SPL_MIME]: ['.spl'],
              'application/json': ['.json'],
            },
          },
        ],
      });
      const file = await handle.getFile();
      await loadProjectFile(
        new Uint8Array(await file.arrayBuffer()),
        handle.name,
        handle.name.toLowerCase().endsWith('.spl')
          ? { kind: 'web', handle, name: handle.name }
          : null,
      );
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        setStatus('打开工程失败：' + errorMessage(error));
    }
  };
  const nodeActions = () =>
    createV4NodeActions({
      runtime: host.getSnapshot().runtime,
      project: host.getSnapshot().project,
      onCommit: (next: Project) => {
        pr.current = next;
      },
    });
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
      s = Math.min((r.width - 80) / p.width, (r.height - 180) / p.height);
    setView({
      s: Math.max(0.05, s),
      x: (r.width - p.width * s) / 2,
      y: (r.height - p.height * s) / 2 - 5,
    });
  };
  const fitViewForEffect = useEffectEvent(fitView);
  const framePaths = (
    ids: string[],
    { force = false }: { force?: boolean } = {},
  ) => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Creation's top bar and bottom palette cover these edges of the SVG.
    // Frame inside the usable window so the selected outline remains readable.
    const inset = {
      x: 16,
      y: 86,
      width: Math.max(1, r.width - 32),
      height: Math.max(1, r.height - 202),
    };
    const next = framePathsView(
      pr.current.paths.filter((path) => ids.includes(path.id) && path.visible),
      inset,
      vr.current,
      { force },
    );
    if (next) setView(next);
  };
  const rpc = <T,>(args: RpcRequest) =>
    new Promise<T>((resolve, reject) => {
      if (!worker.current) {
        reject(Error('底图未准备好'));
        return;
      }
      const id = ++seq.current;
      requests.current.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      worker.current.postMessage({ ...args, id });
    });
  useEffect(() => {
    if (!initialized || gesturing) return;
    if (studioSnapshot.editorState.previewId) return;
    const timer = setTimeout(() => {
      host.autosave().catch((error) => setStatus(errorMessage(error)));
    }, 200);
    return () => clearTimeout(timer);
  }, [
    project,
    initialized,
    gesturing,
    host,
    studioSnapshot.editorState.previewId,
  ]);
  useEffect(() => {
    if (!initialized) return;
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      setReadyImage(null);
      setPreview([]);
      setCandidates([]);
      setShowCandidates(false);
    });
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
            if (data.error) req.reject(Error(data.error));
            else req.resolve(data);
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
        const r = await rpc<ImageInitResponse>({
          type: 'init',
          rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          w: canvas.width,
          h: canvas.height,
        });
        if (!alive) return;
        allCandidates.current = r.candidates.map((p) => ({
          ...p,
          x: p.x / s,
          y: p.y / s,
        }));
        setReadyImage(project.image);
        setStatus('底图就绪');
        fitViewForEffect();
      } catch (error: unknown) {
        setStatus(errorMessage(error));
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
      if (!previous) fitViewForEffect();
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
    {
      if (busyRef.current || drag.current) return;
      studioDrag.cancel();
      host.undo();
      const p = host.getSnapshot().project as Project;
      pr.current = p;
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
      return;
    }
  };
  const redo = () => {
    {
      if (busyRef.current || drag.current) return;
      studioDrag.cancel();
      host.redo();
      const p = host.getSnapshot().project as Project;
      pr.current = p;
      setSelection(null);
      setMergeSource(null);
      if (!p.paths.some((x) => x.id === ar.current && !x.closed)) finish();
      selectPathsNow(
        pathsRef.current.filter((id) => p.paths.some((v) => v.id === id)),
      );
      setStatus('已重做');
      return;
    }
  };
  const finish = () => {
    traceTarget.current = null;
    setMergeSource(null);
    setDrawing(false);
    drawingRef.current = false;
    setPreview([]);
    previewToken.current++;
    setStatus('路径已结束 · 可编辑节点，或新建下一条路径');
  };
  const begin = () => {
    const target = creationApi.current?.trace_target() || null;
    finish();
    traceTarget.current = target;
    setTraceEnd('end');
    setActiveNow(null);
    setTool('trace');
    setSelection(null);
    setStatus('点击新的轮廓起点');
  };
  const finishDrawing = () => {
    if (busyRef.current) return '请先完成当前描线';
    let issue: string | null = null;
    if (host && drawingRef.current && ar.current) {
      try {
        const captured = host.getSnapshot();
        pr.current = captured.runtime
          .commandPath(
            { kind: 'finish-path', pathId: ar.current },
            { project: captured.project },
          )
          .commit() as Project;
      } catch (error) {
        issue = `${errorMessage(error)} · 线条已保留，可从端点续画`;
      }
    }
    finish();
    if (issue) setStatus(issue);
    return issue;
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
    creationApi.current?.select_paths([pathId]);
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
    } catch (error: unknown) {
      setStatus(errorMessage(error));
    }
  };
  const validPoint = (p: unknown): Point => {
    if (typeof p !== 'object' || p === null) {
      throw Error('坐标必须在底图范围内，单位为原图像素');
    }
    const point = p as { x?: unknown; y?: unknown };
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      (point.x as number) < 0 ||
      (point.y as number) < 0 ||
      (point.x as number) >= pr.current.width ||
      (point.y as number) >= pr.current.height
    )
      throw Error('坐标必须在底图范围内，单位为原图像素');
    return { x: point.x as number, y: point.y as number };
  };
  const snapped = async (p: Point, config = sr.current) => {
    const s = scale.current;
    if (!config.snap || config.mode === 'manual') return p;
    const r = await rpc<SnapResponse>({
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
    const r = await rpc<TraceResponse>({
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
      curves: r.curves.map((curve) =>
        curve.map((point) => ({ x: point.x / s, y: point.y / s })),
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
      const captured = host.getSnapshot();
      if (!drawingRef.current || !current || current.closed) {
        setTraceEnd('end');
        const target =
          traceTarget.current || creationApi.current?.trace_target();
        const start = await snapped(p, config);
        const beforeIds = new Set(
          captured.project.paths.map((path: TracePath) => path.id),
        );
        const next = captured.runtime
          .commandPath(
            {
              kind: 'start-path',
              pixelPoint: start,
              ...(target ? { role: target.role, targets: target.targets } : {}),
              ...(target?.ownerNodeId
                ? { ownerNodeId: target.ownerNodeId }
                : {}),
            },
            { project: captured.project },
          )
          .commit() as Project;
        const path = next.paths.find((path) => !beforeIds.has(path.id));
        if (!path) throw Error('新线条未出现在源视图');
        pr.current = next;
        traceTarget.current = null;
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
      if (r.curves.length !== 1) throw Error('续画需要单段拟合结果');
      pr.current = captured.runtime
        .commandPath(
          {
            kind: 'extend-path',
            pathId: current.id,
            end,
            pixelCubic: r.curves[0],
          },
          { project: captured.project },
        )
        .commit() as Project;
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
      const captured = host.getSnapshot();
      const r = await traceSpan(
        splineEndpoint(path, end),
        splineEndpoint(path, end === 'start' ? 'end' : 'start'),
        options,
        false,
      );
      if (r.curves.length !== 1) throw Error('闭合需要单段拟合结果');
      pr.current = captured.runtime
        .commandPath(
          {
            kind: 'close-path',
            pathId: path.id,
            end,
            pixelCubic: r.curves[0],
          },
          { project: captured.project },
        )
        .commit() as Project;
      finish();
      setStatus(
        r.fitError > sr.current.tolerance
          ? `已用一段曲线闭合 · 偏差约 ${r.fitError.toFixed(1)} px，建议手动补点`
          : '已用一段曲线闭合 · 未添加中间锚点',
      );
    });
  const report = (promise: Promise<unknown>) =>
    void promise.catch((error: unknown) => setStatus(errorMessage(error)));
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
    const result = nodeActions().deleteNodes(
      pathId,
      [nodeIndex],
      sr.current.tolerance,
    );
    const next = host.getSnapshot().project as Project;
    const path = next.paths.find((item) => item.id === pathId);
    finish();
    setActiveNow(path ? pathId : null);
    setTool('edit');
    setSelection(null);
    setStatus(
      result.removed
        ? '最后一个节点已删除 · 空路径已移除 · Ctrl+Z 撤销'
        : '节点已删除 · 相邻节点直接连接 · Ctrl+Z 撤销',
    );
    return {
      pathId,
      removedNode: nodeIndex,
      nodes: path ? pathNodes(path).length : 0,
      segments: path?.curves.length || 0,
      removed: result.removed,
    };
  };
  const deleteSelection = () => {
    if (busyRef.current || drag.current) return;
    if (tool === 'select') {
      setStatus('选择工具不修改形状 · 按 A 选择节点后删除');
      return;
    }
    const path = pr.current.paths.find((p) => p.id === ar.current),
      ids = nodesRef.current;
    if (tool !== 'edit' || !path || !ids.length) {
      setStatus('请按 A 并选择节点后删除');
      return;
    }
    try {
      const result = nodeActions().deleteNodes(
        path.id,
        ids,
        sr.current.tolerance,
      );
      setSelection(null);
      if (result.removed) selectPathsNow([]);
      setStatus(
        '已删除 ' + ids.length + ' 个节点 · 相邻节点直接连接 · Ctrl+Z 撤销',
      );
    } catch (error: unknown) {
      setStatus(errorMessage(error));
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
    nodeActions().straighten(pathId, index);
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
    {
      const captured = host.getSnapshot();
      pr.current = captured.runtime
        .commandPath(
          {
            kind: 'merge-paths',
            firstPathId: args.firstId,
            secondPathId: args.secondId,
            firstEnd: args.firstEnd,
            secondEnd: args.secondEnd,
          },
          { project: captured.project },
        )
        .commit();
    }
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
  const studioDrag = useSourceDrag({
    transformMode,
    runtime: studioSnapshot.runtime,
    project,
    pathId: active ?? '',
    nodes: selectedNodes,
    disabled: busy || !!mergeSource,
    isPanning: () => space.current || tool === 'pan',
    getCaptureTarget: () => stage.current,
    toPoint: coordinate,
    onSelectionChange: (nodes, selection) => {
      selectNodesNow(nodes);
      setPointSelection(selection);
    },
    onError: (error) => setStatus(errorMessage(error)),
    onActiveChange: setGesturing,
    onObjectCommit: setObjectMoveCommit,
    snapEnabled: settings.snap,
    scale: view.s,
    onSnapFeedback: (feedback) =>
      setSnapFeedback(feedback as EndpointSnapFeedback | null),
  });
  const cancelGesture = () => {
    studioDrag.cancel();
    const g = drag.current;
    if (!g) return;
    if (g.kind === 'pan') setView(g.view);
    drag.current = null;
    if (stage.current?.hasPointerCapture(g.pointerId))
      stage.current.releasePointerCapture(g.pointerId);
    setMarquee(null);
    setGesturing(false);
    setSnapFeedback(null);
    setStatus('已取消拖动，恢复原位置');
  };
  const handleCanvasContextMenu = useEffectEvent((event: MouseEvent) => {
    event.preventDefault();
    // Capture targets the stage, including drags begun on portal-rendered faces.
    // Some browsers dispatch contextmenu before the right pointer is released.
    if (studioDrag.isActive() || (drag.current && drag.current.button !== 2))
      cancelGesture();
  });
  useEffect(() => {
    if (!stageElement) return;
    const contextMenu = (event: MouseEvent) => handleCanvasContextMenu(event);
    stageElement.addEventListener('contextmenu', contextMenu);
    return () => stageElement.removeEventListener('contextmenu', contextMenu);
  }, [stageElement]);
  const selectCanvasPath = (e: React.PointerEvent, id: string) => {
    if (drag.current) return;
    if (space.current || e.button !== 0 || tool === 'pan') return;
    if (tool === 'move') {
      startObjectDrag(e, { pathId: id });
      return;
    }
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
      creationApi.current?.select_paths([id]);
      return;
    }
    setSelection(null);
    const modified = e.shiftKey || e.ctrlKey || e.metaKey;
    const existing = creationSelectionKind !== 'path' ? [] : pathsRef.current;
    const ids = (
      modified ? pickSelection(existing, id, [], { toggle: true }) : [id]
    ).filter(
      (id: string) => pr.current.paths.find((p) => p.id === id)?.visible,
    );
    selectPathsNow(ids, id);
    creationApi.current?.select_paths(ids);
    setStatus('已选择线条 · 按 A 编辑节点 · 选择工具不会移动形状');
  };
  const startObjectDrag = (
    e: React.PointerEvent,
    target: { pathId?: string; objectId?: string },
  ) => {
    if (drag.current || busyRef.current || tool !== 'move' || e.button !== 0)
      return;
    e.preventDefault();
    e.stopPropagation();
    stage.current?.focus({ preventScroll: true });
    const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
    const selected = creationApi.current?.prepare_move({ ...target, toggle });
    if (!selected?.nodeIds.length || toggle) return;
    if (!selected.canDrag) {
      setStatus('已选中 ' + selected.label + ' · 再次按住拖动可整体移动');
      return;
    }
    studioDrag.onObjectPointerDown(
      e,
      selected.nodeIds,
      selected.pathIds,
      selected.center,
    );
  };
  const pointerDown = (e: React.PointerEvent) => {
    if (drag.current || studioDrag.isActive()) return;
    if (
      (e.target as HTMLElement).closest?.('button,input,select') &&
      (e.button === 0 || !(e.target as HTMLElement).closest('.drawing-canvas'))
    )
      return;
    updateModifiers(e);
    stage.current?.focus({ preventScroll: true });
    const p = coordinate(e);
    if (tool === 'pan' || space.current || e.button === 1 || e.button === 2) {
      e.preventDefault();
      drag.current = {
        kind: 'pan',
        pointerId: e.pointerId,
        button: e.button,
        x: e.clientX,
        y: e.clientY,
        view: vr.current,
        moved: false,
      };
      stage.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (busyRef.current || e.button !== 0 || mergeSource) return;
    if (tool === 'move') {
      setStatus('拖动部件的面或源线变换对象 · 空白处右键拖动平移视图');
      return;
    }
    if (['paint', 'height'].includes(tool)) {
      creationApi.current?.clear();
      return;
    }
    if (tool === 'select' || tool === 'edit') {
      e.preventDefault();
      drag.current = {
        kind: 'box',
        pointerId: e.pointerId,
        button: e.button,
        origin: p,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        add: e.shiftKey || e.ctrlKey || e.metaKey,
        oldPaths: (creationSelectionKind !== 'path'
          ? []
          : pathsRef.current
        ).filter((id) => pr.current.paths.find((p) => p.id === id)?.visible),
        oldNodes: [...nodesRef.current],
      };
      stage.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'trace' && ready && inside(p))
      report(addAnchor(p, connectionSettings(sr.current, e)));
  };
  const pointerMove = (e: React.PointerEvent) => {
    if (creationView === '3d') return;
    if (drag.current) {
      if (drag.current.pointerId !== e.pointerId) return;
      // A missed release must never turn later hovering into an edit.
      const buttonMask =
        drag.current.button === 2 ? 2 : drag.current.button === 1 ? 4 : 1;
      if (!(e.buttons & buttonMask)) {
        cancelGesture();
        return;
      }
    } else if (!(e.target as Element).closest?.('.drawing-canvas')) return;
    const p = coordinate(e);
    setCoords(p);
    lastPointer.current = p;
    updateModifiers(e);
    if (drag.current) {
      const g = drag.current;
      if (g.kind === 'pan') {
        if (!g.moved) {
          if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;
          g.moved = true;
        }
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
    }
    if (
      tool !== 'trace' ||
      !drawingRef.current ||
      busyRef.current ||
      previewBusy.current ||
      !inside(p) ||
      currentTime() - lastPreview.current < 90
    )
      return;
    const path = pr.current.paths.find((p) => p.id === ar.current);
    if (!path || path.closed) return;
    lastPreview.current = currentTime();
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
    queueMicrotask(() => {
      if (previewToken.current === token) setPreview([]);
    });
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
  }, [drawingEnd, modifiers, ready, tool]);
  useEffect(() => {
    if (tool !== 'edit') queueMicrotask(() => setMergeSource(null));
  }, [tool]);
  const mergePathsForEffect = useEffectEvent(mergePaths);
  useEffect(() => {
    if (!mergeTarget) return;
    queueMicrotask(() => {
      setMergeTarget(null);
      if (!mergeSource) return;
      try {
        mergePathsForEffect({
          firstId: mergeSource.pathId,
          firstEnd: mergeSource.end,
          secondId: mergeTarget.pathId,
          secondEnd: mergeTarget.end,
        });
      } catch (error: unknown) {
        setStatus(errorMessage(error));
      }
    });
  }, [mergeSource, mergeTarget]);
  const pointerUp = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g || g.pointerId !== e.pointerId || g.button !== e.button) return;
    drag.current = null;
    if (stage.current?.hasPointerCapture(g.pointerId))
      stage.current.releasePointerCapture(g.pointerId);
    setMarquee(null);
    setGesturing(false);
    setSnapFeedback(null);
    if (g.kind === 'pan') {
      if (g.button === 2 && !g.moved) {
        if (tool === 'trace') finishDrawing();
        else if (mergeSource) setMergeSource(null);
      }
      return;
    }
    if (g.kind === 'box') {
      if (tool === 'select') {
        const hits = g.moved
          ? pr.current.paths
              .filter((p) => p.visible && pathHitsBox(p, g.rect))
              .map((p) => p.id)
          : [];
        selectPathsNow(g.add ? [...g.oldPaths, ...hits] : hits);
        if (!g.add && !hits.length) creationApi.current?.clear();
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
  };
  const startPointDrag = (
    e: React.PointerEvent,
    curve: number,
    point: number,
  ) => {
    if (tool === 'edit') studioDrag.onPointPointerDown(e, curve, point);
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
    try {
      nodeActions().splitSpan(pathId, best.i, best.t);
    } catch (error) {
      setStatus(errorMessage(error));
      return;
    }
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
      if (creationViewRef.current === '3d') return;
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
      studioDrag.onKeyDown(e);
      if (e.defaultPrevented) return;
      updateModifiers(e);
      // Select menus have no text-edit undo stack. Keep document undo/redo
      // available after a keyboard selection, without enabling drawing hotkeys.
      const historyShortcut =
        (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,[role="menu"],[role="slider"],[contenteditable="true"],[role="dialog"]:not(.workspace-dialog-wide)',
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
        setIsSpaceDown(true);
        if (!(e.target as HTMLElement).closest('button,summary'))
          e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
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
          if (pathsRef.current.length)
            movePathBatchRef.current?.(pathsRef.current, '');
        } else groupSelection();
      } else if (e.ctrlKey || e.metaKey || e.altKey) return;
      else if (e.key === 'Enter') {
        if (tool === 'trace') finishDrawing();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (mergeSource) {
          setMergeSource(null);
          setStatus('已取消合并');
        } else if (drawingRef.current) {
          finishDrawing();
        } else if (proposed) {
          setProposed(null);
        } else if (selection || nodesRef.current.length) {
          setSelection(null);
          setStatus('已取消节点选择');
        } else clearSelection();
      } else if (e.key.toLowerCase() === 'p') chooseTool('trace');
      else if (e.key.toLowerCase() === 'v') chooseTool('select');
      else if (e.key.toLowerCase() === 'a') chooseTool('edit');
      else if (e.key.toLowerCase() === 'h') chooseTool('move');
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
      else if (
        e.key.toLowerCase() === 'l' &&
        ((tool === 'edit' && !!selection) ||
          (tool === 'trace' && drawingRef.current))
      ) {
        e.preventDefault();
        try {
          straightenSpan(ar.current || '');
        } catch (error: unknown) {
          setStatus(errorMessage(error));
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      }
    };
    const up = (e: KeyboardEvent) => {
      updateModifiers(e);
      if (e.code === 'Space') {
        space.current = false;
        setIsSpaceDown(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    const blur = () => {
      space.current = false;
      setIsSpaceDown(false);
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
    const startingState = host.getSnapshot().editorState;
    if (startingState?.previewId) throw Error('请先完成或取消拖动，再新建工程');
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
    {
      const image = await fetch(src);
      const bytes = new Uint8Array(await image.arrayBuffer());
      const current = host.getSnapshot().editorState;
      if (
        current.epoch !== startingState.epoch ||
        current.revision !== startingState.revision ||
        current.previewId
      )
        throw Error('读取图片期间工程已改变，请重新新建工程');
      const opened = createReferenceProject({
        bytes,
        mediaType: image.headers.get('content-type'),
        name: f.name,
        width: w,
        height: h,
      });
      const next = host.open(opened, {
        fileName: null,
        blenderExtrusionMM: host.getSnapshot().presentation.blenderExtrusionMM,
      });
      pr.current = next.project as Project;
      finish();
      setActiveNow(null);
      setProposed(null);
      setPendingRefit(null);
      creationApi.current?.clear();
      setStatus('正在分析新底图…');
      return;
    }
  };
  const exportFile = async (format: 'svg' | 'blender' | 'json') => {
    const p = pr.current;
    if (format === 'json') {
      download(host.exportBytes(), 'Splinelet工程.spl', SPL_MIME);
      setStatus('.spl 工程已导出，包含底图和所有编辑数据');
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
  const detect = (args: DetectCandidatesArgs = {}) => {
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
  const createPath = async (
    args: import('@/hooks/trace-agent-contract').AgentCreatePathArgs,
  ) =>
    lock(async () => {
      const captured = host.getSnapshot();
      if (
        !Array.isArray(args.points) ||
        args.points.length < 2 ||
        args.points.length > 200
      )
        throw Error('points 需要 2–200 个坐标或候选点编号');
      const pts: Point[] = args.points.map((p) =>
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
      const plan = captured.runtime.commandPath(
        {
          kind: 'draw-path',
          pixelCubics: path.curves,
          closed: path.closed,
          name: path.name,
        },
        { project: captured.project },
      );
      const commit = () => {
        const beforeIds = new Set(
          captured.project.paths.map((item: TracePath) => item.id),
        );
        const next: Project = plan.commit();
        pr.current = next;
        const added = next.paths.find((item) => !beforeIds.has(item.id));
        if (!added) throw Error('新增源路径无法显示');
        return added;
      };
      let createdId = path.id;
      if (args.preview) {
        proposedCommit.current = { id: path.id, commit };
        setProposed(path);
        setStatus(
          `候选路径已生成 · ${path.curves.length} 段曲线` +
            ((path.fitError || 0) > config.tolerance
              ? ` · 偏差约 ${path.fitError!.toFixed(1)} px，建议手动补点`
              : '，检查后接受'),
        );
      } else {
        createdId = commit().id;
        setActiveNow(createdId);
        finish();
        setStatus(
          `已创建「${path.name}」· ${path.curves.length} 段曲线` +
            ((path.fitError || 0) > config.tolerance
              ? ` · 偏差约 ${path.fitError!.toFixed(1)} px，建议手动补点`
              : ''),
        );
      }
      return {
        id: createdId,
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
    nodeActions().setModes(args.pathId, [args.nodeIndex], args.mode);
    setStatus(
      args.mode === 'corner'
        ? '节点已设为尖角 · 控制柄独立'
        : args.mode === 'smooth'
          ? '节点已设为平滑 · 两侧手柄共线联动'
          : '节点已设为对称连续 · 两侧手柄共线且等长',
    );
    return { pathId: args.pathId, nodeIndex: args.nodeIndex, mode: args.mode };
  };
  function movePathBatch(
    ids: string[],
    groupId: string,
    targetId?: string,
    after = false,
  ) {
    if (busyRef.current || drag.current) throw Error('请先完成当前操作');
    {
      commitGroup({
        kind: 'move-group-paths',
        pathIds: ids,
        groupId,
        targetId,
        after,
      });
      setStatus('已移动 ' + ids.length + ' 条路径 · Ctrl+Z 撤销');
      return {
        moved: !targetId || !ids.includes(targetId),
        pathIds: ids,
        groupId,
      };
    }
  }
  useEffect(() => {
    movePathBatchRef.current = movePathBatch;
  });
  const movePath = (a: {
    pathId: string;
    groupId?: string;
    beforeId?: string;
  }) => movePathBatch([a.pathId], a.groupId || '', a.beforeId);
  const manageGroup = (a: AgentGroupArgs) => {
    if (busyRef.current) throw Error('请等待当前拟合完成');
    const action = a.action,
      groups = pr.current.groups || [],
      name = a.name ?? '',
      pathIds = a.pathIds ?? [],
      visible = a.visible ?? false;
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
      (!name.trim() || name.length > 80)
    )
      throw Error('分组名称需要 1–80 个字符');
    if (
      action === 'assign' &&
      (!pathIds.length ||
        pathIds.some(
          (id: string) => !pr.current.paths.some((p) => p.id === id),
        ))
    )
      throw Error('请选择存在的路径');
    if (action === 'visibility' && typeof a.visible !== 'boolean')
      throw Error('visible 必须为布尔值');
    let id = action === 'create' ? crypto.randomUUID() : a.id;
    {
      const next = commitGroup({
        kind: (
          {
            create: 'create-group',
            rename: 'rename-group',
            assign: 'assign-group',
            visibility: 'group-visibility',
            delete: 'delete-group',
          } as Record<string, string>
        )[action],
        groupId: a.id,
        name,
        pathIds: action === 'assign' ? pathIds : [],
        visible,
      });
      if (action === 'create')
        id = next.groups?.find(
          (item) => !groups.some((old) => old.id === item.id),
        )?.id;
    }
    setStatus(
      action === 'delete'
        ? '已解散分组，曲线已移至未分组 · 可撤销'
        : '分组已更新 · 未保存工程文件 · Ctrl+S 保存 · 可撤销',
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
      const captured = host.getSnapshot();
      const sourceProject = captured.project as Project;
      const original = sourceProject.paths.find(
        (p) => p.id === (args.id || ar.current),
      );
      if (!original) throw Error('请先选中路径');
      // Refit current source spans without collapsing short edges or changing
      // their identities.
      const points = original.curves.map((curve) => curve[0]);
      if (!original.closed && original.curves.length)
        points.push(original.curves.at(-1)![3]);
      if (points.length < 2) throw Error('这条路径没有足够的原落点记录');
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
      pr.current = captured.runtime
        .commandPath(
          {
            kind: 'refit-path',
            pathId: original.id,
            pixelCubics: path.curves,
          },
          { project: captured.project },
        )
        .commit();
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
    let id = proposed.id;
    {
      if (proposedCommit.current?.id !== proposed.id)
        throw Error('候选路径上下文已失效，请重新生成');
      id = proposedCommit.current.commit().id;
    }
    setStatus('候选路径已接受');
    setActiveNow(id);
    setProposed(null);
    return { id };
  };
  const apiRef = useRef<TraceApi | null>(null);
  useEffect(() => {
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
          fileName: displayedFileName || null,
          status: saved,
          fileSystemSupported:
            typeof window !== 'undefined' &&
            !!(window as FilePickerWindow).showSaveFilePicker,
        },
        active: ar.current,
        tool,
        selectedPaths: pathsRef.current,
        workspace,
        model: modelApi.current?.state(),
        creation: creationApi.current?.state(),
        selectedNodes: nodesRef.current,
        gesturing: !!drag.current || studioDrag.isActive(),
        nodeSnapping: { enabled: nodeSnap, keepSeams, target: snapFeedback },
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
      set_workspace: (a: AgentWorkspaceArgs) => {
        if (!['trace', 'faces', 'relief'].includes(a.mode))
          throw Error('mode 必须为 trace、faces 或 relief');
        finish();
        setWorkspace(a.mode);
        if (a.mode !== 'trace')
          modelApi.current?.show_settings({
            tab: a.mode === 'relief' ? 'output' : 'create',
          });
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
          (a: unknown) => {
            if (!modelApi.current) throw Error('建模工作空间未准备好');
            return modelApi.current[name](a);
          },
        ]),
      ),
      creation_inspect: () => creationApi.current?.inspect(() => pr.current),
      creation_focus: (a: AgentCreationFocusArgs) =>
        creationApi.current?.focus(a.objectId),
      creation_select: (a: AgentCreationSelectArgs) =>
        creationApi.current?.select_cells(a.cellKeys),
      creation_command: (a: AgentCreationCommandArgs) =>
        creationApi.current?.command(a.action, a.args ?? {}, a.revision),
      creation_view: (a: AgentCreationViewArgs) => {
        if (!['flat', '3d'].includes(a.view))
          throw Error('view 必须为 flat 或 3d');

        setWorkspace('trace');
        setCreationView(a.view);
      },
      creation_export: (a: AgentCreationExportArgs) =>
        creationApi.current?.export(a.format, false),
      create_path: createPath,
      spline_inspect: (a: Parameters<typeof inspectSplines>[1]) =>
        inspectSplines(pr.current, a),
      spline_apply: (a: unknown) => {
        if (busyRef.current || fileBusyRef.current || drag.current)
          throw Error('请先完成当前描线、拖动或保存');
        const captured = host.getSnapshot();
        const result = captured.runtime
          .commandSplines(a, { project: captured.project })
          .commit();
        pr.current = result.project as Project;
        finish();
        setProposed(null);
        setStatus(`已提交 ${result.pathIds.length} 条精确样条 · Ctrl+Z 撤销`);
        return { pathIds: result.pathIds };
      },
      resume_path: (a: AgentPathEndArgs) => resumePath(a.pathId, a.end),
      add_anchor: (a: { position: Point } & Partial<TraceSettings>) =>
        addAnchor(a.position, a),
      finish_path: () => {
        if (busyRef.current || fileBusyRef.current || drag.current)
          throw Error('请先完成当前描线、拖动或保存');
        const issue = finishDrawing();
        if (issue) throw Error(issue);
        return { finished: true };
      },
      close_path: (a: Partial<TraceSettings>) => closePath(a),
      refit_path: requestRefit,
      set_node_mode: changeNodeMode,
      manage_group: manageGroup,
      move_path: movePath,
      select_paths: (a: AgentPathListArgs) => {
        if (
          !Array.isArray(a.pathIds) ||
          a.pathIds.some(
            (id: string) => !pr.current.paths.some((p) => p.id === id),
          )
        )
          throw Error('pathIds 必须为现有路径 ID');
        chooseGroup(a.pathIds, false);
        creationApi.current?.select_paths(pathsRef.current);
        return { selectedPaths: pathsRef.current };
      },
      move_paths: (a: AgentMovePathsArgs) => {
        if (!Array.isArray(a.pathIds)) throw Error('需要 pathIds');
        return movePathBatch(a.pathIds, a.groupId || '', a.targetId, !!a.after);
      },
      merge_paths: (a: AgentMergeArgs) => mergePaths(a),
      straighten_span: (a: AgentSpanArgs) => straightenSpan(a.pathId, a.curve),
      select_node: (a: AgentNodeArgs) => selectNode(a.pathId, a.nodeIndex),
      delete_node: (a: AgentNodeArgs) => deleteNode(a.pathId, a.nodeIndex),
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
      set_view: (a: AgentViewArgs) => {
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
      select_path: (a: { id: string }) => {
        if (!pr.current.paths.some((p) => p.id === a.id))
          throw Error('路径不存在');
        chooseGroup([a.id], false);
        return { id: a.id };
      },
      set_point: (a: AgentPointArgs) => {
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
        nodeActions().moveHandle(a.pathId, a.curve, a.point, point);
        return { updated: true };
      },
      export: (a: AgentExportArgs) => {
        if (a.format === 'svg')
          return { filename: '角色轮廓.svg', content: svg(pr.current) };
        if (a.format === 'blender')
          return {
            filename: '角色曲线_blender.py',
            content: blender(pr.current),
          };
        if (a.format === 'json' && host) {
          const bytes = host.exportBytes();
          const chunks = [];
          for (let i = 0; i < bytes.length; i += 16384)
            chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
          return {
            filename: 'Splinelet工程.spl',
            mimeType: SPL_MIME,
            base64: btoa(chunks.join('')),
          };
        }
        if (a.format === 'json')
          return {
            filename: 'Splinelet工程.bezier.json',
            content: JSON.stringify(pr.current),
          };
        throw Error('format 必须是 svg、blender 或 json');
      },
      load_project: async (a: AgentLoadProjectArgs) => {
        if (busyRef.current || fileBusyRef.current)
          throw Error('请等待拟合或保存完成');
        const input = readAgentProjectInput(a);
        return loadProjectFile(input.bytes, input.name, null);
      },
      set_candidates_visible: (a: AgentVisibilityArgs) => {
        setShowCandidates(!!a.visible);
        return { visible: !!a.visible };
      },
    };
  });
  const loadDesktopProject = useEffectEvent(loadProjectFile);
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let alive = true;
    let stop: (() => void) | undefined;
    const openPaths = async (paths: string[]) => {
      const path = paths.at(-1);
      if (!path || !alive) return;
      try {
        const legacy = !path.toLowerCase().endsWith('.spl');
        await loadDesktopProject(
          await desktopReadFile(path),
          projectNameFromPath(path),
          legacy
            ? null
            : { kind: 'desktop', path, name: projectNameFromPath(path) },
        );
      } catch (error: unknown) {
        if (alive) setStatus('打开工程失败：' + errorMessage(error));
      }
    };
    const start = async () => {
      stop = await listenDesktopOpenFiles((paths) => void openPaths(paths));
      await openPaths(await desktopPendingOpenPaths());
    };
    void start().catch((error: unknown) => {
      if (alive) setStatus('桌面文件服务启动失败：' + errorMessage(error));
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);
  useEffect(() => {
    const traceWindow = window as TraceStudioWindow;
    host.setSelectionReader(() => creationApi.current?.readSelection() || null);
    traceWindow.traceStudio = {
      version: '5.0',
      call: async (action: string, args: unknown = {}) => {
        if (
          action.includes('.') ||
          (['undo', 'redo'].includes(action) &&
            typeof args === 'object' &&
            args !== null &&
            'expectedRevision' in args)
        )
          return host.agentCall(action, args);
        const fn = apiRef.current?.[action];
        if (!fn) throw Error('未知操作 ' + action);
        if (studioAgentTools[action]?.compatibilityWrite) {
          const request = args as Record<string, unknown>;
          if (!request || !Number.isInteger(request.expectedRevision))
            throw Error(
              '兼容写操作必须提供 document.get 返回的 expectedRevision',
            );
          if (
            request.expectedRevision !== host.getSnapshot().editorState.revision
          )
            throw Error('expectedRevision 已过期，请重新读取工程');
          const { expectedRevision: _revision, ...payload } = request;
          args = payload;
        }
        if (
          drag.current &&
          !['state', 'get_project', 'inspect_geometry', 'export'].includes(
            action,
          )
        )
          throw Error('请先完成或取消当前拖动');
        return await fn(args as never);
      },
    };
    const context = (
        document as Document & {
          modelContext?: {
            registerTool: (
              definition: unknown,
              options: { signal: AbortSignal },
            ) => Promise<unknown>;
          };
        }
      ).modelContext,
      controller = new AbortController();
    const names = Object.keys(studioAgentTools);
    for (const name of names)
      try {
        void Promise.resolve(
          context?.registerTool(
            {
              name: 'bezier_' + name,
              description: studioAgentTools[name]!.description,
              inputSchema: {
                type: 'object',
                properties: {
                  ...studioAgentTools[name]!.properties,
                  ...(studioAgentTools[name]!.compatibilityWrite && {
                    expectedRevision: { type: 'integer' },
                  }),
                },
                required: [
                  ...new Set([
                    ...(studioAgentTools[name]!.compatibilityWrite
                      ? ['expectedRevision']
                      : []),
                    ...(studioAgentTools[name]!.required || []),
                  ]),
                ],
                additionalProperties: false,
              },
              annotations: {
                readOnlyHint: studioAgentTools[name]!.readOnly,
                untrustedContentHint: true,
              },
              execute: (args: unknown) =>
                traceWindow.traceStudio!.call(name, args).then(agentJSONValue),
            },
            { signal: controller.signal },
          ),
        ).catch(() => {});
      } catch {}
    // Optional loopback companion, development only. Hosted app never connects.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      try {
        const r = await fetch('http://127.0.0.1:4318/next', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiRef.current?.state()),
        });
        if (r.ok) {
          const commands: unknown = await r.json();
          if (!Array.isArray(commands)) return;
          for (const command of commands) {
            if (
              typeof command !== 'object' ||
              command === null ||
              !('action' in command) ||
              typeof command.action !== 'string'
            )
              continue;
            const commandArgs = 'args' in command ? command.args : undefined;
            let result;
            try {
              result = {
                id: 'id' in command ? command.id : undefined,
                result: await traceWindow.traceStudio!.call(
                  command.action,
                  commandArgs,
                ),
              };
            } catch (error: unknown) {
              result = {
                id: 'id' in command ? command.id : undefined,
                error: errorMessage(error),
              };
            }
            await fetch('http://127.0.0.1:4318/result', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(agentJSONValue(result)),
            });
          }
        }
      } catch {}
      timer = setTimeout(tick, 700);
    };
    if (location.hostname === 'localhost' && location.port === '3000')
      void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      host.setSelectionReader(null);
      delete traceWindow.traceStudio;
    };
  }, [host]);
  const geometryReport: GeometryReportItem[] =
    dialog === 'export' ? inspectGeometry(project.paths) : [];
  const current = project.paths.find((p) => p.id === active),
    count = project.paths.reduce((s, p) => s + p.curves.length, 0);
  const endpointGuides = useMemo(() => {
    if (!nodeSnap || tool !== 'edit' || !current || selectedNodes.length !== 1)
      return [];
    return (
      studioSnapshot.runtime.readEndpointSnapContext(
        project,
        current.id,
        selectedNodes[0],
      )?.lines || []
    );
  }, [project, current, tool, selectedNodes, nodeSnap, studioSnapshot]);
  const projectSettings = (
    <>
      {' '}
      <div aria-label="工程设置">
        <section>
          <h3>参考底图</h3>
          <p>
            {project.imageName} · {project.width} × {project.height}
          </p>
        </section>
        <section>
          <h3>工程尺寸</h3>
          <span>底图对应宽度（mm）</span>
          <NumberEdit
            label="底图对应宽度"
            value={project.widthMM}
            min={0.1}
            max={10000}
            onCommit={(widthMM) => {
              try {
                host.setSourceWidth(widthMM);
              } catch (error) {
                setStatus(errorMessage(error));
              }
            }}
          />
          <p>按整张底图宽度设置物理比例，影响整个作品。</p>
        </section>
      </div>{' '}
    </>
  );
  const sourceInspector = (
    <aside
      className="inspector"
      style={
        {
          '--inspector-width': inspectorWidth + 'px',
        } as React.CSSProperties
      }
    >
      <div className="properties-area">
        <div aria-label="节点属性" hidden={propertyTab !== 'node'}>
          <section className="endpoint-snap-settings" aria-label="端点吸附设置">
            <h3>端点吸附</h3>
            <label>
              <input
                type="checkbox"
                checked={nodeSnap}
                onChange={(e) => setNodeSnap(e.target.checked)}
              />
              端点吸附
            </label>
            <label>
              <input
                type="checkbox"
                checked={keepSeams}
                disabled={!nodeSnap}
                onChange={(e) => setKeepSeams(e.target.checked)}
              />
              保持已有对称接缝
            </label>
            <p>
              拖近端点或接缝时吸附；已有接缝可沿线滑动。Alt 暂时解除，Shift
              轴向移动并暂停吸附。
            </p>
          </section>
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
                    nodeActions().setModes(current.id, selectedNodes, mode);
                    setStatus(
                      '已更新 ' +
                        selectedNodes.length +
                        ' 个节点的连接方式 · 可撤销',
                    );
                  } catch (error: unknown) {
                    setStatus(errorMessage(error));
                  }
                }}
                onStraighten={(curve) => {
                  try {
                    straightenSpan(current.id, curve);
                  } catch (error: unknown) {
                    setStatus(errorMessage(error));
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
        <div aria-label="描线参数" hidden={propertyTab !== 'trace'}>
          <button
            title="标记候选拐点"
            aria-label="标记候选拐点"
            className={showCandidates ? 'selected' : ''}
            onClick={() => {
              if (showCandidates) setShowCandidates(false);
              else
                try {
                  detect();
                } catch (error: unknown) {
                  setStatus(errorMessage(error));
                }
            }}
            disabled={!ready}
          >
            <Target size={20} />
            <small>候选点</small>
          </button>
          <SplineTraceControls
            path={selectedPaths.length === 1 ? current : undefined}
            drawing={drawing}
            end={drawingEnd}
            disabled={busy || !ready || gesturing}
            onResume={resumeSelected}
            onFinish={finishDrawing}
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
              <span>识别目标</span>
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
        <div aria-label="路径与分组" hidden={propertyTab !== 'paths'}>
          <SplinePathInspector
            path={creationSelectionKind === 'path' ? current : undefined}
            count={creationSelectionKind === 'path' ? selectedPaths.length : 0}
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
      </div>
    </aside>
  );
  return (
    <main
      role="application"
      className="studio creation-studio"
      onDragOverCapture={(e) => e.preventDefault()}
      onDropCapture={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0])
          report(
            /\.svg$/i.test(e.dataTransfer.files[0].name)
              ? importVector(e.dataTransfer.files[0])
              : importImage(e.dataTransfer.files[0]),
          );
      }}
    >
      <header data-tauri-drag-region={isDesktopRuntime() ? '' : undefined}>
        <StudioFileMenu
          fileBusy={fileBusy}
          busy={busy}
          onOpen={() => void openProjectFile()}
          onNewFromImage={() => file.current?.click()}
          onImportVector={() => vectorFile.current?.click()}
          onSave={() => void saveProject()}
          onSaveAs={() => void saveProject(true)}
          onHelp={() => setDialog('help')}
          onApi={() => setDialog('api')}
          onExample={() =>
            report(
              fetch('/sandrone-example.spl').then(async (r) => {
                if (!r.ok) throw Error('示例读取失败');
                const bytes = new Uint8Array(await r.arrayBuffer());
                return loadProjectFile(bytes, 'sandrone-example.spl', null);
              }),
            )
          }
        />
        <span
          className="project-name"
          data-tauri-drag-region={isDesktopRuntime() ? '' : undefined}
        >
          <span title={displayedFileName || '未绑定文件'}>
            {displayedFileName || '未命名工程'}
          </span>{' '}
          <i title={saved} aria-label={saved}>
            <span className="sr-only">{saved}</span>
          </i>
        </span>
        <div className="header-actions">
          <button
            className="header-save"
            aria-label="保存工程"
            title={saved + ' · Ctrl S 保存到同一文件'}
            disabled={fileBusy}
            onClick={() => void saveProject()}
          >
            <Save size={16} />
          </button>
          <button
            className="header-export"
            onClick={() => creationApi.current?.show_output()}
          >
            <Download size={16} />
            导出
          </button>
        </div>
        <DesktopWindowControls />
        <input
          ref={vectorFile}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) report(importVector(file));
            e.target.value = '';
          }}
        />
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
          accept=".spl,.bezier.json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f)
              report(
                f
                  .arrayBuffer()
                  .then((bytes) =>
                    loadProjectFile(new Uint8Array(bytes), f.name, null),
                  ),
              );
            e.target.value = '';
          }}
        />
      </header>
      <nav
        className="workspace-switch creation-workspace-switch"
        aria-label="视图"
      >
        <button
          aria-pressed={creationView === 'flat'}
          onClick={() => {
            finish();
            setWorkspace('trace');

            setCreationView('flat');
          }}
        >
          平面创作
        </button>
        <button
          aria-pressed={creationView === '3d'}
          onClick={() => {
            finish();
            setWorkspace('trace');

            setCreationView('3d');
            chooseTool('select');
          }}
        >
          <Box size={16} />
          立体预览
        </button>
        <span>
          {creationView === '3d'
            ? '立体预览 · 旋转查看，选择区域'
            : '平面创作 · 描轮廓，填颜色，调高低'}
        </span>
      </nav>
      <div className="workspace">
        <nav className="toolrail" aria-label="绘图工具">
          {(
            [
              [MousePointer2, 'select', '选择', 'V'],
              [Spline, 'edit', '节点', 'A'],
              [PenTool, 'trace', '描线', 'P'],
              [PaintBucket, 'paint', '上色', ''],
              [ArrowUpFromLine, 'height', '高低', ''],
              [Move, 'move', '变换对象', 'H'],
            ] as Array<[typeof MousePointer2, string, string, string]>
          ).map(([Icon, value, label, key]) => (
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
            disabled={!historySize || busy}
          >
            <Undo2 size={19} />
          </button>
          <button
            title="重做 Ctrl Shift Z"
            aria-label="重做"
            onClick={redo}
            disabled={!futureSize || busy}
          >
            <Redo2 size={19} />
          </button>
        </nav>
        <div
          role="application"
          ref={setStage}
          aria-label="编辑画布"
          className={`stage tool-${tool} creation-stage ${creationView === '3d' ? 'creation-is-3d' : ''}`}
          onPointerMove={(e) => {
            if (studioDrag.isActive()) studioDrag.onPointerMove(e);
            else pointerMove(e);
          }}
          onPointerUp={(e) => {
            studioDrag.onPointerUp(e);
            pointerUp(e);
          }}
          onPointerCancel={(e) => {
            studioDrag.onPointerCancel(e);
            if (drag.current?.pointerId === e.pointerId) cancelGesture();
          }}
          onLostPointerCapture={(e) => {
            studioDrag.onLostPointerCapture(e);
            if (drag.current?.pointerId === e.pointerId) cancelGesture();
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
                    : tool === 'move'
                      ? '变换对象 · 右键拖动平移视图'
                      : tool === 'pan'
                        ? '空格 / 中键拖动画布 · 滚轮缩放'
                        : tool === 'select'
                          ? '选择 · 不移动形状'
                          : '平移画布'}
            </span>
            <span>
              {project.imageName} · {project.width} × {project.height}
            </span>
          </div>
          <svg
            className="drawing-canvas"
            aria-label="贝塞尔绘图画布"
            onPointerDown={pointerDown}
            onPointerLeave={() => {
              if (!drag.current) {
                setPreview([]);
                previewToken.current++;
              }
            }}
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
              <SourcePathLayers
                paths={project.paths.filter(
                  (p) =>
                    p.visible &&
                    !project.creation?.objects.some(
                      (o: { pathIds: string[]; visible: boolean }) =>
                        o.pathIds.includes(p.id) && !o.visible,
                    ),
                )}
                scale={view.s}
                tool={tool}
                selectedPaths={selectedPaths}
                highlightSourceSelection={highlightSourceSelection}
                fill={fill}
                onSelectPath={selectCanvasPath}
                onEditPath={(pathId) => {
                  setActiveNow(pathId);
                  chooseTool('edit');
                }}
                onSplitAt={splitAt}
              />
              {current?.visible && (
                <g>
                  {tool === 'edit' ? (
                    <SourceNodeHandles
                      path={current}
                      scale={view.s}
                      selectedNodes={selectedNodes}
                      selection={selection}
                      onPointPointerDown={startPointDrag}
                    />
                  ) : tool === 'trace' ||
                    (tool === 'select' &&
                      selectedPaths.length === 1 &&
                      creationSelectionKind === 'path') ? (
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
              <EndpointSnapOverlay
                feedback={snapFeedback}
                scale={view.s}
                guides={endpointGuides}
              />
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
                          <a
                            key={path.id + end}
                            href={'#merge-' + path.id + '-' + end}
                            aria-label={
                              '合并到 ' +
                              path.name +
                              ' ' +
                              (end === 'start' ? '起点' : '终点')
                            }
                            data-merge-endpoint={path.id + ':' + end}
                            onPointerDown={(event) => {
                              if (event.button !== 0 || isSpaceDown) return;
                              event.stopPropagation();
                              event.preventDefault();
                              setMergeTarget({ pathId: path.id, end });
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
                          </a>
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
              <button
                className="primary"
                onClick={() => {
                  try {
                    acceptPreview();
                  } catch (error) {
                    setStatus(errorMessage(error));
                  }
                }}
              >
                <Check size={15} />
                接受
              </button>
              <button onClick={() => setProposed(null)}>丢弃</button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="inspector-resizer"
          aria-label="调整右侧栏宽度"
          onDoubleClick={() => setInspectorWidth(320)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              setInspectorWidth((width) =>
                clampInspector(width + (e.key === 'ArrowLeft' ? 20 : -20)),
              );
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            inspectorResizeDrag.current = {
              x: e.clientX,
              width: inspectorWidth,
            };
          }}
          onPointerMove={(e) => {
            const current = inspectorResizeDrag.current;
            if (current)
              setInspectorWidth(
                clampInspector(current.width + current.x - e.clientX),
              );
          }}
          onPointerUp={() => (inspectorResizeDrag.current = null)}
          onPointerCancel={() => (inspectorResizeDrag.current = null)}
        />
        <>
          <CreationWorkspace
            project={project}
            runtime={studioSnapshot.runtime}
            enabled={true}
            viewMode={creationView}
            tool={tool}
            onTool={chooseTool}
            onView={(view) => {
              cancelGesture();
              setCreationView(view);
            }}
            onStatus={setStatus}
            onApi={(api) => {
              creationApi.current = api;
              if (pendingVectorFocus.current) {
                const id = pendingVectorFocus.current;
                pendingVectorFocus.current = null;
                api.focus(id);
                api.show_tool();
              }
            }}
            layer={creationLayer}
            stage={stageElement}
            scale={view.s}
            width={inspectorWidth}
            selectedPaths={selectedPaths}
            onSelectPaths={(ids) => selectPathsNow(ids)}
            onSelectionKind={setCreationSelectionKind}
            onFramePaths={framePaths}
            onCanvasPointerDown={pointerDown}
            onMoveObject={startObjectDrag}
            objectMoveCommit={objectMoveCommit}
            transformMode={transformMode}
            onTransformMode={(mode) => {
              studioDrag.cancel();
              setTransformMode(mode);
            }}
            objectMoving={studioDrag.isObjectActive()}
            sourceInspector={sourceInspector}
            onSourceExport={() => {
              setDialog('export');
            }}
            displaySettings={
              <>
                {' '}
                <section>
                  <label className="switch-label">
                    隐藏底图{' '}
                    <Switch
                      aria-label="隐藏底图"
                      checked={vectorsOnly}
                      onCheckedChange={setVectorsOnly}
                    />
                  </label>
                  <label className="switch-label">
                    源线闭合填充{' '}
                    <Switch
                      aria-label="源线闭合填充"
                      checked={fill}
                      onCheckedChange={setFill}
                    />
                  </label>
                </section>
              </>
            }
            projectSettings={projectSettings}
            onAdvanced={(mode) => {
              finish();
              setWorkspace(mode);
              modelApi.current?.show_settings({
                tab: mode === 'relief' ? 'output' : 'create',
              });
            }}
            onNewPath={begin}
            busy={busy || gesturing}
            opacity={opacity}
            onOpacity={setOpacity}
          />
        </>
      </div>
      <ModelWorkspace
        project={project}
        runtime={studioSnapshot.runtime}
        mode={workspace}
        initialPaths={selectedPaths}
        onEditSource={(id) => {
          setWorkspace('trace');
          setActiveNow(id);
          chooseTool('edit');
        }}
        onApi={(api) => {
          modelApi.current = api;
        }}
        onMode={setWorkspace}
        onOutput={(partId) => {
          setWorkspace('trace');
          creationApi.current?.show_output(partId);
        }}
        onUndo={undo}
        onRedo={redo}
        status={setStatus}
      />
      <footer>
        <output>
          <span className="live-dot" />
          {status}
        </output>
        <span className="storage-status" aria-live="polite" title={saved}>
          {saved}
        </span>
        <span>
          {count} 段
          {coords &&
          coords.x >= 0 &&
          coords.y >= 0 &&
          coords.x < project.width &&
          coords.y < project.height
            ? ` · X ${Math.round(coords.x)} Y ${Math.round(coords.y)}`
            : ''}{' '}
          · 滚轮缩放 · 右键/空格平移
        </span>
      </footer>
      {vectorInput && (
        <VectorImportDialog
          input={vectorInput}
          widthMM={project.widthMM}
          objects={project.creation?.objects || []}
          onClose={() => setVectorInput(null)}
          onImport={(options) => {
            try {
              if (
                busyRef.current ||
                fileBusyRef.current ||
                studioDrag.isActive()
              )
                throw Error('请先完成当前操作');
              const captured = host.getSnapshot();
              if (captured.project !== vectorInput.project)
                throw Error('工程已变化，请重新导入');
              const imported = captured.runtime
                .commandVectorImport(
                  {
                    name: vectorInput.name,
                    splines: vectorInput.splines,
                    bounds: vectorInput.bounds,
                    ...options,
                  },
                  { project: captured.project },
                )
                .commit();
              pr.current = imported as Project;
              pendingVectorFocus.current =
                captured.runtime.readCreationDocument(imported).tree.at(-1)
                  ?.id || null;
              setVectorInput(null);
              setCreationView('flat');
              chooseTool('move');
              setStatus('已导入可编辑 SVG 对象组 · Ctrl+Z 撤销');
              return null;
            } catch (error) {
              setStatus(errorMessage(error));
              return errorMessage(error);
            }
          }}
        />
      )}
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
            <button onClick={() => setPendingRefit(null)}>
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
              ? '源曲线导出'
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
              <p className="export-note">
                当前工程宽度：{project.widthMM} mm。物理比例在“工程设置”中修改。
              </p>
              <div className="dimension-fields">
                <label>
                  源曲线脚本挤出厚度
                  <input
                    type="number"
                    aria-label="挤出厚度"
                    min="0"
                    max="1000"
                    step=".5"
                    value={project.depthMM}
                    onChange={(e) => {
                      const v = +e.target.value;
                      if (v >= 0 && v <= 1000) {
                        host.setBlenderExtrusion(v);
                      }
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
                  onClick={() => report(exportFile('svg'))}
                  disabled={!count}
                >
                  导出 SVG
                </button>
              </div>
              <div className="export-option">
                <div>
                  <b>Blender 源曲线脚本</b>
                  <p>
                    只处理源曲线；闭合路径按上方厚度挤出。成品实体请从输出属性导出。打开
                    Scripting 工作区运行 .py。
                  </p>
                </div>
                <button
                  onClick={() => report(exportFile('blender'))}
                  disabled={!count}
                >
                  导出 .py
                </button>
              </div>
              <div className="export-option">
                <div>
                  <b>可继续编辑的完整工程</b>
                  <p>底图、路径、尺寸与控制点 · 完整工程文件</p>
                </div>
                <button onClick={() => report(exportFile('json'))}>
                  导出 .spl 工程副本
                </button>
              </div>
              <p className="export-note">
                抽样几何检查：
                {geometryReport.reduce((n, p) => n + p.gaps, 0)} 处缺口，
                {geometryReport.reduce(
                  (n, p) => n + p.selfIntersections.length,
                  0,
                )}{' '}
                处自交。
                {geometryReport
                  .filter((p) => p.selfIntersections.length)
                  .map((p) => p.name)
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
              <pre>{`const call = window.traceStudio.call;\nconst observed = await call('document.get');\nconst changed = await call('authoring.run', {\n  expectedRevision: observed.revision,\n  action: { kind: 'create-shape', name: '刘海' },\n});\nawait call('undo', { expectedRevision: changed.revision });`}</pre>
              <p>
                先用 capabilities.get 发现 API 5 操作，再用 document.get
                读取修订；每个写入传回读取到的 expectedRevision。 WebMCP 的
                bezier_ 工具和浏览器调用使用同一注册表。
              </p>
              <p>
                creation_command、spline_apply
                和原图像素描线入口保留兼容调用；写入同样需要
                expectedRevision，paint / height 另带最新 creation_inspect
                revision。
              </p>
              <p>
                构面 /
                浮雕操作：preview_region、commit_region_preview、inspect_model、select_regions、create_relief、set_relief、set_model_options、create_part、select_part、validate_part、get_relief_mesh、export_model。几何坐标以毫米为单位，源路径仍是图像像素。支持
                WebMCP 的浏览器会注册 bezier_ 前缀工具。本地配套 HTTP
                服务可连接同一工作台，供 Agent 批量调用与读回验证。
              </p>
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
                追加。选择工具不移动形状；按 A 或双击曲线进入节点编辑。
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
                在“工程 → 导出”中检查实体并导出。
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
                　H
                移动整个部件；滚轮缩放；右键、空格拖动或中键平移；右侧边界调整宽度，不重置缩放。自动保存仅用于恢复草稿，Ctrl+S
                才保存工程文件，Ctrl+Shift+S 另存为。导出面板提供分色 SVG、3MF
                和 Blender 实体与源线；精确贝塞尔 SVG 在“工程 → 导出 → 源曲线
                SVG”导出。
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
