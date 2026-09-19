'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  Plus,
  Eye,
  EyeOff,
  X,
  PaintBucket,
  Layers,
  ArrowUpFromLine,
  Pencil,
  Pipette,
  Download,
  GripVertical,
  Focus,
} from 'lucide-react';
import {
  type Project,
  download,
  blender,
  validateProject,
} from '@/lib/project';
import {
  creationDocument,
  acceptDividerGraph,
} from '@/lib/creation-schema.mjs';
import { creationCommand } from '@/lib/creation-commands.mjs';
import { bindSurfaceGraphs } from '@/lib/surface-lineage.mjs';
import { regionSVGPath } from '@/lib/geometry-format.mjs';
import { meshSTL } from '@/lib/mesh-format.mjs';
import { deliver3MF } from '@/lib/manufacturing-download';
import SlicerTemplate from '../shared/slicer-template';
import CreationView from './creation-view';
import CreationConnections from './creation-connections';
import CreationModifiers from './creation-modifiers';
import ConstructionPipeline from './construction-pipeline';
import CreationColor from './creation-color';
import CreationIssue from './creation-issue';
import CreationSelectionDetails from './creation-selection-details';
import CreationSwatchDelete from './creation-swatch-delete';
import NumberEdit from '../shared/creation-number';
import PrintStack, { PrintPlacement } from './creation-print-stack';
import { printCount, printMM, resolvePrintStack } from '@/lib/print-stack.mjs';
import {
  creationEditTargets,
  regionLabel,
  pathsForRegions,
} from '@/lib/creation-selection.mjs';
import { useCreationSelection } from '@/hooks/use-creation-selection';
// @ts-expect-error Vite worker asset.
import ModelWorker from '../../lib/model-worker.ts?worker';
type Props = {
  project: Project;
  enabled: boolean;
  viewMode: string;
  tool: string;
  onTool: (t: string) => void;
  onView: (v: string) => void;
  onProject: (p: Project, record?: boolean) => void;
  onStatus: (s: string) => void;
  onApi: (a: any) => void;
  layer: SVGGElement | null;
  stage: HTMLDivElement | null;
  scale: number;
  width: number;
  selectedPaths: string[];
  onSelectPaths: (ids: string[]) => void;
  onSelectionKind: (kind: 'object' | 'path' | 'cell') => void;
  onStartDrag: (
    e: React.PointerEvent,
    id: string,
    fromSource?: boolean,
  ) => void;
  onCanvasPointerDown: (e: React.PointerEvent) => void;
  onFramePaths: (ids: string[], options?: { force?: boolean }) => void;
  sourceInspector: ReactNode;
  onAdvanced: (mode: string) => void;
  onNewPath: () => void;
  busy: boolean;
  opacity: number;
  onOpacity: (n: number) => void;
};
function Name({
  value,
  label,
  onRename,
}: {
  value: string;
  label: string;
  onRename: (s: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null),
    done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    setDraft(null);
    if (draft?.trim() && draft.trim() !== value) onRename(draft.trim());
  };
  return draft === null ? (
    <span
      className="creation-name"
      title="双击重命名"
      onDoubleClick={(e) => {
        e.stopPropagation();
        done.current = false;
        setDraft(value);
      }}
    >
      {value}
    </span>
  ) : (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      maxLength={120}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          done.current = true;
          setDraft(null);
        }
      }}
    />
  );
}
export default function CreationWorkspace(p: Props) {
  const ref = useRef(p);
  ref.current = p;
  const doc = creationDocument(p.project),
    [scene, setScene] = useState<any>(null),
    sceneRef = useRef<any>(null),
    revision = useRef<Project | null>(null),
    roleChecking = useRef(false),
    pendingRoleResult = useRef<any>(null),
    sequence = useRef(0),
    worker = useRef<Worker | null>(null),
    requests = useRef(new Map<number, any>());
  const [boot, setBoot] = useState(false),
    [calculating, setCalculating] = useState(false),
    [checkingRole, setCheckingRole] = useState(false),
    [roleIssue, setRoleIssue] = useState<any>(null),
    [roleResult, setRoleResult] = useState<any>(null),
    [error, setError] = useState('');
  const [tab, setTab] = useState('object'),
    [brush, setBrush] = useState('cream'),
    [editingSwatch, setEditingSwatch] = useState(false),
    [search, setSearch] = useState(''),
    [dragTarget, setDragTarget] = useState('');
  const [draftHeight, setDraftHeight] = useState<number | null>(null),
    heightDrag = useRef<any>(null),
    paintDrag = useRef<any>(null),
    [paintKeys, setPaintKeys] = useState<string[]>([]),
    [joinPreview, setJoinPreview] = useState<any>(null),
    [connectionHighlight, setConnectionHighlight] = useState<any[]>([]),
    [report, setReport] = useState<any>(null),
    [exporting, setExporting] = useState(false),
    [showLines, setShowLines] = useState(true),
    [displayMode, setDisplayMode] = useState('reference');
  const space = useRef(false),
    cellClick = useRef<{
      key: string;
      x: number;
      y: number;
      pointerId: number;
      moved: boolean;
    } | null>(null),
    moving = useRef<any>(null),
    root = useRef<HTMLElement>(null),
    nextRole = useRef('boundary'),
    revisionId = useRef(0);
  const selectionState = useCreationSelection({
    doc,
    scene,
    selectedPaths: p.selectedPaths,
    onSelectPaths: p.onSelectPaths,
    root,
    onTab: setTab,
    onChoose: (next) => {
      heightDrag.current = null;
      setDraftHeight(null);
      if (
        next.ids.length &&
        next.kind !== 'path' &&
        !['select', 'paint', 'height'].includes(ref.current.tool)
      )
        p.onTool('select');
    },
  });
  const {
    selection,
    objects,
    cellKeys,
    scope,
    expanded,
    setExpanded,
    expandedCells,
    setExpandedCells,
  } = selectionState;
  useEffect(
    () => p.onSelectionKind(selection.kind),
    [selection.kind, p.onSelectionKind],
  );
  const [basePreview, setBasePreview] = useState<any>(null),
    [baseMargin, setBaseMargin] = useState(1),
    [baseHeight, setBaseHeight] = useState(2);
  const connectionRequest = useRef(0),
    focusedObject = useRef<string | undefined>(undefined);
  const current = doc.objects.find((o: any) => o.id === objects.at(-1)),
    cell = scene?.cells.find((c: any) => c.key === cellKeys.at(-1)),
    swatch = doc.swatches.find((s: any) => s.id === brush) || doc.swatches[0];
  focusedObject.current = current?.id;
  const clearConnectionPreview = () => {
    connectionRequest.current++;
    setJoinPreview(null);
    setConnectionHighlight([]);
  };
  useEffect(() => {
    clearConnectionPreview();
    setRoleIssue(null);
    setRoleResult(null);
  }, [current?.id]);
  const failedSelection = scene?.errors.some((e: any) =>
    objects.includes(e.objectId),
  );
  const sourceOnly =
    current &&
    scene &&
    !calculating &&
    !scene.cells.some((c: any) => objects.includes(c.objectId));
  useEffect(() => {
    if (['trace', 'edit'].includes(p.tool)) chooseDisplay('reference');
    else if (p.tool === 'paint') chooseDisplay('overlay');
    else if (p.tool === 'height') chooseDisplay('color');
  }, [p.tool]);
  function chooseDisplay(mode: string) {
    setDisplayMode(mode);
    setShowLines(mode !== 'color');
  }
  useEffect(() => {
    p.stage?.setAttribute(
      'data-creation-lines',
      p.enabled && !showLines ? 'hidden' : 'shown',
    );
    return () => {
      p.stage?.removeAttribute('data-creation-lines');
    };
  }, [p.stage, p.enabled, showLines]);
  useEffect(() => {
    if (p.enabled) p.stage?.setAttribute('data-creation-display', displayMode);
    return () => {
      p.stage?.removeAttribute('data-creation-display');
    };
  }, [p.stage, p.enabled, displayMode]);
  const call = (
    action: string,
    args: any = {},
    project = ref.current.project,
  ) =>
    new Promise<any>((resolve, reject) => {
      if (!worker.current) {
        reject(Error('几何引擎尚未准备好'));
        return;
      }
      const id = ++sequence.current;
      requests.current.set(id, { resolve, reject });
      worker.current.postMessage({
        id,
        action,
        args,
        project: { ...project, image: '' },
      });
    });
  useEffect(() => {
    const w = new ModelWorker() as Worker;
    worker.current = w;
    w.onmessage = ({ data }) => {
      const r = requests.current.get(data.id);
      if (!r) return;
      requests.current.delete(data.id);
      if (data.error) r.reject(Error(data.error));
      else r.resolve(data.result);
    };
    w.onerror = () => {
      setError('区域引擎加载失败，请刷新后重试');
      for (const r of requests.current.values())
        r.reject(Error('引擎加载失败'));
      requests.current.clear();
    };
    setBoot(true);
    return () => {
      w.terminate();
      worker.current = null;
      for (const r of requests.current.values())
        r.reject(Error('工作台已关闭'));
      requests.current.clear();
    };
  }, []);
  useEffect(() => {
    if (!boot) return;
    let cancelled = false;
    const snapshot = p.project;
    setRoleIssue(null);
    setRoleResult(null);
    revisionId.current++;
    setCalculating(true);
    clearConnectionPreview();
    setBasePreview(null);
    setReport(null);
    const timer = setTimeout(() => {
      call('creation', {}, snapshot)
        .then((result) => {
          if (cancelled || ref.current.project !== snapshot) return;
          const bound = bindSurfaceGraphs(snapshot, result);
          if (bound !== snapshot && !ref.current.busy) {
            p.onProject(bound, false);
            return;
          }
          setScene(result);
          sceneRef.current = result;
          revision.current = snapshot;
          setError('');
        })
        .catch((e) => {
          if (!cancelled) {
            setScene(null);
            sceneRef.current = null;
            revision.current = null;
            setError(e.message);
          }
        })
        .finally(() => {
          if (!cancelled) setCalculating(false);
        });
    }, 70);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [p.project, p.busy, boot]);
  const notify = (message: string) => {
    setError('');
    p.onStatus(message);
  };
  const run = (action: string, args: any = {}) => {
    if (ref.current.busy) throw Error('请先完成当前拖动或描线');
    if (
      (['paint', 'height', 'continue_partition', 'rebuild_surfaces'].includes(
        action,
      ) ||
        action.startsWith('modifier_') ||
        action.startsWith('print_')) &&
      revision.current !== ref.current.project
    )
      throw Error('正在更新区域，请稍候再操作');
    const next = creationCommand(
      ref.current.project,
      action,
      args,
      sceneRef.current,
    );
    p.onProject(next);
    clearConnectionPreview();
    notify(
      action === 'paint'
        ? '已填色 · Ctrl+Z 撤销'
        : action === 'height'
          ? '已调整高低 · Ctrl+Z 撤销'
          : action === 'closure_boundary'
            ? '已调整封口 · Ctrl+Z 撤销'
            : action.startsWith('modifier_')
              ? '已更新修改器 · Ctrl+Z 撤销'
              : '已更新作品',
    );
    return next;
  };
  const safely = (fn: () => any) => {
    try {
      const value = fn();
      if (value?.catch)
        value.catch((e: any) => {
          setError(e.message);
          p.onStatus(e.message);
        });
    } catch (e: any) {
      setError(e.message);
      p.onStatus(e.message);
    }
  };
  function selectObject(
    id: string,
    e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
    frame = false,
  ) {
    const selected = selectionState.choose('object', id, e);
    if (frame) p.onFramePaths(selected.paths);
  }
  function selectCell(key: string, add = false) {
    if (!key) {
      clear();
      return;
    }
    selectionState.choose('cell', key, { ctrlKey: add });
  }
  function clear() {
    selectionState.clear();
    clearConnectionPreview();
    setEditingSwatch(false);
  }
  const targets = () => creationEditTargets(selection);
  const printHeight = doc.printStack?.layerHeightMM;
  const applyHeight = (value: number) =>
    run('height', {
      ...targets(),
      ...(printHeight ? { heightLayers: value } : { heightMM: value }),
    });
  const selectedHeight =
    (scope === 'local' ? cell?.heightMM : current?.heightMM) ?? 1;
  const displayedHeight =
    draftHeight ??
    (printHeight ? printCount(selectedHeight, printHeight) : selectedHeight);
  const heightMinimum = printHeight ? 1 : 0.01;
  const heightMaximum = printHeight ? Math.floor(1000 / printHeight) : 1000;
  const cancel = () => {
    cellClick.current = null;
    heightDrag.current = null;
    paintDrag.current = null;
    setDraftHeight(null);
    setPaintKeys([]);
    clearConnectionPreview();
    setBasePreview(null);
  };
  function commitPaint() {
    const g = paintDrag.current;
    paintDrag.current = null;
    setPaintKeys([]);
    if (g?.keys.size)
      safely(() =>
        run('paint', { cellKeys: [...g.keys], swatchId: g.swatchId }),
      );
  }
  useEffect(() => {
    if (!p.enabled) return;
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable],[role="dialog"]',
        )
      )
        return;
      if (e.code === 'Space') space.current = true;
      if (
        e.key.toLowerCase() === 'f' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !p.busy &&
        p.viewMode === 'flat'
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        p.onFramePaths(selectionState.paths, { force: true });
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'z' &&
        (heightDrag.current || paintDrag.current)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
        notify('已取消当前手势');
        return;
      }
      if (e.key === 'Escape') {
        cellClick.current = null;
        // The source editor owns in-progress source gestures and their rollback.
        if (p.busy && !heightDrag.current && !paintDrag.current) return;
        // Let its own Escape ladder finish tracing, cancel merging or clear
        // nodes. A workspace listener must not also change tools and tabs.
        if (
          ['trace', 'edit'].includes(p.tool) &&
          !heightDrag.current &&
          !paintDrag.current &&
          !joinPreview &&
          !connectionHighlight.length &&
          !basePreview
        )
          return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (
          heightDrag.current ||
          paintDrag.current ||
          joinPreview ||
          connectionHighlight.length ||
          basePreview
        ) {
          cancel();
          notify('已取消本次操作');
        } else clear();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'a' &&
        (e.target as HTMLElement).closest('.creation-sidebar')
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        selectionState.commit({
          kind: 'object',
          ids: doc.objects.map((o: any) => o.id),
        });
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        ['paint', 'height'].includes(p.tool)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        notify('删除线条请切换到节点工具；填色可通过撤销恢复');
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false;
    };
    const blur = () => {
      space.current = false;
      cancel();
    };
    const pointerMove = (e: PointerEvent) => {
      const g = cellClick.current;
      if (
        g &&
        g.pointerId === e.pointerId &&
        Math.hypot(e.clientX - g.x, e.clientY - g.y) >= 4
      )
        g.moved = true;
    };
    const pointerCancel = () => {
      cellClick.current = null;
    };
    const pointerUp = (e: PointerEvent) => {
      const g = cellClick.current;
      cellClick.current = null;
      if (
        g &&
        g.pointerId === e.pointerId &&
        !g.moved &&
        Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4
      )
        selectCell(g.key);
      if (paintDrag.current) commitPaint();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointercancel', pointerCancel);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointercancel', pointerCancel);
    };
  });
  const svgExport = () => {
    const invalid = scene?.errors.find((e: any) =>
      scene.creation.objects.some((o: any) => o.id === e.objectId && o.visible),
    );
    if (invalid) throw Error('请先修复区域：' + invalid.message);
    if (revision.current !== p.project) throw Error('请等待区域更新后导出');
    const escape = (s: string) =>
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
    const body = scene.creation.printStack
      ? scene.creation.printStack.layers
          .map(
            (layer: any) =>
              `<g id="${escape(layer.id)}" data-name="${escape(layer.name)}">${scene.cells
                .filter(
                  (c: any) =>
                    c.printLayerId === layer.id &&
                    c.painted &&
                    c.mode !== 'cut' &&
                    c.mode !== 'through' &&
                    scene.creation.objects.find((o: any) => o.id === c.objectId)
                      ?.visible,
                )
                .map(
                  (c: any) =>
                    `<path data-object-id="${escape(c.objectId)}" data-name="${escape(c.name || c.key)}" d="${regionSVGPath(c.geometry, p.project)}" fill="${c.color}" fill-rule="evenodd"/>`,
                )
                .join('')}</g>`,
          )
          .join('\n')
      : scene.creation.objects
          .filter((o: any) => o.visible)
          .map(
            (o: any) =>
              `<g id="${escape(o.id)}" data-name="${escape(o.name)}">${scene.cells
                .filter((c: any) => c.objectId === o.id && c.painted)
                .map((c: any) => {
                  if (c.conflict) throw Error('请先处理标记的颜色冲突');
                  return `<path d="${regionSVGPath(c.geometry, p.project)}" fill="${c.color}" fill-rule="evenodd"/>`;
                })
                .join('')}</g>`,
          )
          .join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${p.project.widthMM}mm" height="${(p.project.widthMM * p.project.height) / p.project.width}mm" viewBox="0 0 ${p.project.width} ${p.project.height}">${body}</svg>`;
  };
  async function exportWork(format: string, save = true) {
    const snapshot = ref.current.project;
    if (format === 'svg') {
      const content = svgExport();
      if (save) download(content, '作品-分色.svg', 'image/svg+xml');
      return { content };
    }
    setExporting(true);
    try {
      if (
        format === '3mf' ||
        format === '3mf-generic' ||
        format === '3mf-bambu'
      ) {
        if (format === '3mf-bambu' && !snapshot.model?.slicerTemplate)
          throw Error(
            '请先在「3MF 切片配置」载入一个 Bambu Studio 工程作为模板，之后可一直复用。',
          );
        const result = await call(
          '3mf',
          {
            partId: snapshot.model?.parts[0]?.id || 'main',
            slicerTemplate:
              format === '3mf-bambu' ? snapshot.model?.slicerTemplate : null,
          },
          snapshot,
        );
        if (ref.current.project !== snapshot)
          throw Error('作品已修改，请重新导出');
        setReport(result);
        return deliver3MF(result, save);
      }
      const r = await call(
        'solid',
        { partId: snapshot.model?.parts[0]?.id || 'main' },
        snapshot,
      );
      if (ref.current.project !== snapshot)
        throw Error('作品已修改，请重新检查后导出');
      setReport(r);
      if (format === 'check') return r;
      if (!r.report.valid || r.report.components !== 1)
        throw Error('成品尚不是一个有效相连的实体，请检查底板或分离区域');
      if (format === 'stl') {
        const bytes = meshSTL(r.mesh);
        if (save) {
          const url = URL.createObjectURL(
              new Blob([bytes], { type: 'model/stl' }),
            ),
            a = document.createElement('a');
          a.href = url;
          a.download = '作品-浮雕.stl';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
        return { mesh: r.mesh, report: r.report };
      }
      const mesh = JSON.stringify(r.mesh),
        content =
          blender({
            ...snapshot,
            paths: snapshot.paths.map((path) => ({ ...path, visible: true })),
          }) +
          `\n# Source curves and the checked solid; all coordinates below are mm.\ncollection.hide_render=True\ncollection.hide_viewport=True\nDATA_MESH=json.loads(${JSON.stringify(mesh)})\nsolid_collection=bpy.data.collections.new('Splinelet · 创作成品')\nbpy.context.scene.collection.children.link(solid_collection)\nmesh=bpy.data.meshes.new('成品')\nvs=DATA_MESH['positions'];ts=DATA_MESH['triangles']\nmesh.from_pydata([tuple(v*.001 for v in vs[i:i+3]) for i in range(0,len(vs),3)],[],[ts[i:i+3] for i in range(0,len(ts),3)])\nmesh.update()\nobj=bpy.data.objects.new('成品',mesh)\nsolid_collection.objects.link(obj)\n`;
      if (save) download(content, '作品-Blender.py', 'text/x-python');
      return { content, report: r.report };
    } finally {
      setExporting(false);
    }
  }
  useEffect(() => {
    p.onApi({
      state: () => ({
        revision: revisionId.current,
        objects: doc.objects,
        swatches: doc.swatches,
        printStack: doc.printStack,
        printLevels: scene?.printLevels,
        selection,
        selectedObjects: objects,
        selectedCells: cellKeys,
        calculating,
        errors: scene?.errors || [],
        conflicts:
          scene?.cells.filter((c: any) => c.conflict).map((c: any) => c.key) ||
          [],
        view: p.viewMode,
        displayMode,
      }),
      inspect: async () => {
        const snapshot = ref.current.project;
        const result = await call('creation', {}, snapshot);
        if (ref.current.project !== snapshot)
          throw Error('作品已变化，请重新读取候选区域');
        return { ...result, revision: revisionId.current };
      },
      command: (action: string, args: any, expectedRevision?: number) => {
        if (
          ['paint', 'height'].includes(action) &&
          expectedRevision !== revisionId.current
        )
          throw Error('候选区域修订号已过期，请重新调用 creation_inspect');
        return action === 'roles' ? applyRoles(args) : run(action, args);
      },
      focus: (id: string) => selectObject(id, {}, true),
      select_paths: selectionState.selectPaths,
      select_cells: (keys: string[]) => {
        if (keys.some((k) => !scene?.cells.some((c: any) => c.key === k)))
          throw Error('选区已变化');
        selectionState.commit({ kind: 'cell', ids: keys });
      },
      new_path: (path: any) => {
        const c = creationDocument(ref.current.project),
          o = c.objects.find((o: any) => o.id === objects.at(-1));
        if (o) {
          acceptDividerGraph(o);
          o.pathIds.push(path.id);
          o.roles[path.id] = nextRole.current;
          return c;
        }
      },
      show_output: () => setTab('make'),
      export: exportWork,
      clear,
    });
  });
  async function applyRoles(args: any) {
    if (ref.current.busy || roleChecking.current)
      throw Error('请先完成当前操作');
    const snapshot = ref.current.project;
    const next = creationCommand(snapshot, 'roles', args, sceneRef.current);
    const beforeCount =
      sceneRef.current?.cells.filter((c: any) => c.objectId === args.objectId)
        .length || 0;
    setCheckingRole(true);
    roleChecking.current = true;
    setRoleIssue(null);
    setRoleResult(null);
    try {
      const result = await call('creation', {}, next);
      if (ref.current.project !== snapshot)
        throw Error('线条已变化，请重新设置用途');
      const failure = result.errors.find(
        (e: any) => e.objectId === args.objectId,
      );
      if (failure && failure.kind !== 'pipeline' && args.role !== 'guide') {
        const issue = { ...failure, pathIds: args.pathIds };
        setRoleIssue(issue);
        p.onStatus('本次用途切换未应用；原区域与颜色保留');
        return { applied: false, issue };
      }
      p.onProject(next);
      clearConnectionPreview();
      if (failure?.kind === 'pipeline') {
        notify('用途已更新 · 下游构造已暂停，请修复或重建分区输出');
        return { applied: true, blocked: true, issue: failure };
      }
      const afterCount = result.cells.filter(
        (c: any) => c.objectId === args.objectId,
      ).length;
      const message =
        args.role === 'divider'
          ? args.pathIds.every((id: string) =>
              result.diagnostics.some(
                (d: any) =>
                  d.objectId === args.objectId &&
                  d.pathId === id &&
                  d.status === 'existing_boundary',
              ),
            )
            ? '已是带状面的边界 · 区域、颜色和高度保留；封口请在“构面封口”中调整'
            : afterCount > beforeCount
              ? `分区完成 · ${beforeCount} → ${afterCount} 个区域`
              : `已设为分区线 · 仍为 ${afterCount} 个区域。若希望继续拆分，请检查线条是否贯穿区域、两端是否接合。`
          : args.role === 'guide'
            ? '已设为参考线 · 线条保留，暂不参与分区'
            : '线条用途已更新';
      // Keep the result tied to the committed project; source edits clear it.
      pendingRoleResult.current = {
        project: next,
        message,
        objectId: args.objectId,
      };
      notify(message);
      return { applied: true, regionCount: afterCount };
    } finally {
      roleChecking.current = false;
      setCheckingRole(false);
    }
  }
  useEffect(() => {
    const result = pendingRoleResult.current;
    if (result?.project === p.project) setRoleResult(result);
    pendingRoleResult.current = null;
  }, [p.project]);
  const chooseRole = (role: string) =>
    safely(() =>
      applyRoles({
        objectId: current.id,
        pathIds: p.selectedPaths.filter((id) => current.pathIds.includes(id)),
        role,
      }),
    );
  const startHeight = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    heightDrag.current = { y: e.clientY, value: displayedHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraftHeight(displayedHeight);
  };
  const effectiveScene = basePreview?.scene || scene;
  const editedDraft =
    effectiveScene && draftHeight !== null
      ? {
          ...effectiveScene,
          cells: effectiveScene.cells.map((c: any) =>
            (
              scope === 'object'
                ? objects.includes(c.objectId)
                : cellKeys.includes(c.key)
            )
              ? {
                  ...c,
                  heightMM: printHeight
                    ? printMM(draftHeight, printHeight)
                    : draftHeight,
                }
              : c,
          ),
        }
      : effectiveScene;
  const draftScene =
    editedDraft && draftHeight !== null && printHeight
      ? {
          ...editedDraft,
          ...resolvePrintStack(
            editedDraft.creation,
            editedDraft.cells,
            editedDraft.errors,
          ),
        }
      : editedDraft;
  if (!p.enabled) return null;
  const rendered = basePreview?.scene || joinPreview || scene;
  // Display choices affect only the canvas; saved colours and exports stay intact.
  const showFills = displayMode !== 'reference' || !!basePreview;
  const fillAlpha = displayMode === 'color' ? 1 : 0.24;
  return (
    <>
      {p.layer &&
        rendered &&
        createPortal(
          <g className={'creation-fills ' + (showLines ? '' : 'without-lines')}>
            {rendered.cells.map((c: any) => {
              const o = rendered.creation.objects.find(
                (o: any) => o.id === c.objectId,
              );
              if (
                !o?.visible ||
                c.mode === 'cut' ||
                c.mode === 'through' ||
                c.enabled === false
              )
                return null;
              const candidate = !c.painted,
                active =
                  cellKeys.includes(c.key) ||
                  (selection.kind === 'object' && objects.includes(o.id)),
                painting = paintKeys.includes(c.key);
              return (
                <path
                  key={c.key}
                  data-creation-cell={c.key}
                  data-object-id={o.id}
                  data-region-status={candidate ? 'candidate' : 'enabled'}
                  className={
                    'creation-cell ' +
                    (candidate ? 'candidate ' : '') +
                    (active ? 'active ' : '')
                  }
                  d={regionSVGPath(c.geometry, p.project)}
                  fill={painting ? swatch?.color : c.color}
                  fillRule="evenodd"
                  fillOpacity={
                    (showFills || painting ? fillAlpha : 0) *
                    (candidate && !painting ? 0.12 : 1)
                  }
                  stroke={
                    active
                      ? '#d4fa99'
                      : candidate && showFills
                        ? '#b5cfb3'
                        : 'none'
                  }
                  strokeWidth={(active ? 2 : 1) / p.scale}
                  strokeDasharray={
                    candidate && !active
                      ? `${5 / p.scale} ${4 / p.scale}`
                      : undefined
                  }
                  style={{
                    pointerEvents:
                      !basePreview &&
                      ['select', 'paint', 'height'].includes(p.tool)
                        ? 'all'
                        : 'none',
                  }}
                  onPointerDown={(e) => {
                    // This SVG layer is a React portal. Its events do not bubble
                    // through Home's stage handlers even though the DOM is inside it.
                    if (e.button === 1 || space.current) {
                      p.onCanvasPointerDown(e);
                      return;
                    }
                    if (e.button !== 0 || space.current) return;
                    if (p.tool === 'select') {
                      if (e.ctrlKey || e.metaKey || e.shiftKey) {
                        selectionState.choose('cell', c.key, e);
                        e.stopPropagation();
                        return;
                      }
                      if (
                        selection.kind !== 'cell' ||
                        !cellKeys.includes(c.key)
                      )
                        selectCell(c.key);
                      else if (cellKeys.length > 1)
                        cellClick.current = {
                          key: c.key,
                          x: e.clientX,
                          y: e.clientY,
                          pointerId: e.pointerId,
                          moved: false,
                        };
                      const id = o.pathIds.find((id: string) =>
                        p.project.paths.some((path) => path.id === id),
                      );
                      if (id) p.onStartDrag(e, id, false);
                      else e.stopPropagation();
                    } else if (p.tool === 'paint') {
                      e.preventDefault();
                      e.stopPropagation();
                      selectCell(c.key);
                      paintDrag.current = {
                        keys: new Set([c.key]),
                        swatchId: swatch.id,
                      };
                      setPaintKeys([c.key]);
                    } else if (p.tool === 'height') {
                      selectCell(c.key);
                      e.stopPropagation();
                    }
                  }}
                  onPointerEnter={() => {
                    if (paintDrag.current) {
                      paintDrag.current.keys.add(c.key);
                      setPaintKeys([...paintDrag.current.keys]);
                    }
                  }}
                  onPointerUp={() => {
                    if (paintDrag.current) commitPaint();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    selectCell(c.key);
                  }}
                >
                  <title>
                    {regionLabel(c, rendered)}
                    {candidate ? ' · 待启用区域' : ''}
                  </title>
                </path>
              );
            })}
            {(
              joinPreview?.connections?.filter(
                (c: any) => c.objectId === current?.id,
              ) || connectionHighlight
            )
              .filter((c: any) => c.from && c.to)
              .map((c: any, i: number) => (
                <path
                  key={i}
                  d={(c.coordinates || [c.from, c.to])
                    .map(
                      ([x, y]: number[], index: number) =>
                        `${index ? 'L' : 'M'} ${p.project.width / 2 + (x * p.project.width) / p.project.widthMM} ${p.project.height / 2 - (y * p.project.width) / p.project.widthMM}`,
                    )
                    .join(' ')}
                  data-construction-connection={c.featureId || c.pathId || i}
                  fill="none"
                  stroke="#ffa65f"
                  strokeWidth={3 / p.scale}
                  strokeDasharray={`${7 / p.scale} ${4 / p.scale}`}
                  pointerEvents="none"
                />
              ))}
          </g>,
          p.layer,
        )}
      {p.stage &&
        createPortal(
          <>
            {p.viewMode === '3d' && (
              <CreationView
                scene={draftScene}
                selected={
                  scope === 'object'
                    ? (draftScene?.cells || [])
                        .filter((c: any) => objects.includes(c.objectId))
                        .map((c: any) => c.key)
                    : cellKeys
                }
                tool={p.tool}
                onSelect={(key, modifiers) => {
                  if (key) selectionState.choose('cell', key, modifiers);
                  else clear();
                  if (key && p.tool === 'paint')
                    safely(() =>
                      run('paint', { cellKeys: [key], swatchId: swatch.id }),
                    );
                }}
              />
            )}
            <div
              className="creation-canvas-bar"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span>
                {selection.kind === 'cell' && cellKeys.length === 1 && cell
                  ? regionLabel(cell, scene)
                  : selection.kind === 'path' && selection.ids.length === 1
                    ? p.project.paths.find(
                        (path) => path.id === selection.ids[0],
                      )?.name
                    : current?.name || '选择区域或线条，开始创作'}
                {selection.kind === 'cell' && cell
                  ? cellKeys.length === 1
                    ? ' / 单个区域'
                    : ` / 已选 ${cellKeys.length} 个区域`
                  : selection.kind === 'path' && selection.ids.length
                    ? ` / 已选 ${selection.ids.length} 条线`
                    : current
                      ? ' / 整个部件'
                      : ''}
              </span>
              {p.viewMode === 'flat' && (
                <div
                  className="creation-display-switch"
                  role="group"
                  aria-label="平面显示"
                >
                  {[
                    ['reference', '底图', '显示底图与源线，隐藏区域填色'],
                    ['overlay', '叠色', '以透明填色对照底图'],
                    ['color', '分色', '显示完整的区域颜色'],
                  ].map(([value, label, title]) => (
                    <button
                      key={value}
                      title={title}
                      aria-pressed={displayMode === value}
                      onClick={() => chooseDisplay(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {p.viewMode === 'flat' && (
                <label>
                  <input
                    type="checkbox"
                    checked={showLines}
                    onChange={(e) => {
                      setShowLines(e.target.checked);
                    }}
                  />
                  全部线条
                </label>
              )}
              {p.viewMode === 'flat' && (
                <label>
                  底图
                  <input
                    aria-label="创作底图透明度"
                    type="range"
                    min="0"
                    max="100"
                    value={p.opacity}
                    onChange={(e) => p.onOpacity(+e.target.value)}
                  />
                </label>
              )}
            </div>
            {scope !== 'source' &&
              (objects.length > 0 || cellKeys.length > 0) &&
              p.tool === 'height' && (
                <div
                  className="creation-height-handle"
                  onPointerDown={startHeight}
                  onPointerMove={(e) => {
                    if (heightDrag.current)
                      setDraftHeight(
                        Math.max(
                          heightMinimum,
                          Math.min(
                            heightMaximum,
                            printHeight
                              ? Math.round(
                                  heightDrag.current.value +
                                    (heightDrag.current.y - e.clientY) / 8,
                                )
                              : Math.round(
                                  (heightDrag.current.value +
                                    (heightDrag.current.y - e.clientY) * 0.02) *
                                    100,
                                ) / 100,
                          ),
                        ),
                      );
                  }}
                  onPointerUp={() => {
                    if (!heightDrag.current) return;
                    heightDrag.current = null;
                    const n = draftHeight;
                    setDraftHeight(null);
                    if (n !== null) safely(() => applyHeight(n));
                  }}
                  onPointerCancel={cancel}
                  role="slider"
                  tabIndex={0}
                  aria-label="拖动区域高度"
                  aria-valuemin={heightMinimum}
                  aria-valuemax={heightMaximum}
                  aria-valuenow={displayedHeight}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      cancel();
                      e.stopPropagation();
                    }
                    if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
                      e.preventDefault();
                      safely(() =>
                        applyHeight(
                          Math.max(
                            heightMinimum,
                            Math.min(
                              heightMaximum,
                              displayedHeight +
                                (e.key === 'ArrowUp' ? 1 : -1) *
                                  (printHeight ? 1 : 0.1),
                            ),
                          ),
                        ),
                      );
                    }
                  }}
                >
                  <ArrowUpFromLine size={22} />
                  <b>
                    {printHeight ? displayedHeight : displayedHeight.toFixed(2)}
                  </b>
                  <small>{printHeight ? '打印层' : 'mm'}</small>
                </div>
              )}
            <div
              className="creation-palette"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span>项目色</span>
              <div className="creation-swatches">
                {doc.swatches.map((s: any) => (
                  <button
                    key={s.id}
                    title={s.name + ' · ' + s.color}
                    aria-label={'画笔色：' + s.name}
                    aria-pressed={swatch?.id === s.id}
                    style={{ '--swatch': s.color } as React.CSSProperties}
                    onClick={() => {
                      setBrush(s.id);
                      setEditingSwatch(false);
                    }}
                    onDoubleClick={() => {
                      setBrush(s.id);
                      setEditingSwatch(true);
                      setTab('object');
                    }}
                  >
                    <i />
                    {swatch?.id === s.id && <small>{s.name}</small>}
                  </button>
                ))}
              </div>
              <button
                title="添加项目色"
                aria-label="添加项目色"
                onClick={() =>
                  safely(() => {
                    const next = run('swatch', {
                      color: swatch?.color || '#d2b777',
                      name: '新颜色',
                    });
                    setBrush(next.creation.swatches.at(-1).id);
                    setEditingSwatch(true);
                  })
                }
              >
                <Plus size={16} />
              </button>
            </div>
            {basePreview && (
              <div
                className="creation-preview-actions"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span>
                  底板预览 · {baseMargin} mm 边距 / {baseHeight} mm 厚
                </span>
                <button
                  onClick={() =>
                    safely(() => {
                      if (basePreview.revision !== ref.current.project)
                        throw Error('来源已变化，请重新预览');
                      p.onProject(validateProject(basePreview.project));
                      selectionState.commit({
                        kind: 'object',
                        ids: [basePreview.objectId],
                      });
                      setTab('make');
                      setBasePreview(null);
                      notify('已生成承托部件 · Ctrl+Z 撤销');
                    })
                  }
                >
                  添加承托部件
                </button>
                <button onClick={() => setBasePreview(null)}>取消底板</button>
              </div>
            )}
            {calculating && (
              <div className="creation-updating">正在更新区域…</div>
            )}
          </>,
          p.stage,
        )}
      <aside
        className="creation-sidebar"
        ref={root}
        style={{ width: p.width }}
        aria-label="作品对象与属性"
      >
        <div className="creation-tree-head">
          <b>作品</b>
          <span>{doc.objects.length} 个对象</span>
          <button
            aria-label="定位选中内容 (F)"
            title="定位选中内容 · F"
            disabled={!selectionState.paths.length || p.viewMode !== 'flat'}
            onClick={() =>
              p.onFramePaths(selectionState.paths, { force: true })
            }
          >
            <Focus size={16} />
          </button>
          <button
            aria-label="新建创作对象"
            title="新建部件"
            onClick={() =>
              safely(() => {
                const next = run('new_object');
                const id = next.creation.objects.at(-1).id;
                selectionState.commit({ kind: 'object', ids: [id] });
              })
            }
          >
            <Plus size={17} />
          </button>
          <button aria-label="取消对象选择" onClick={clear}>
            <X size={16} />
          </button>
        </div>
        <input
          className="creation-search"
          aria-label="搜索创作对象"
          placeholder="查找部件或线条…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div
          className="creation-tree"
          role="tree"
          aria-label="创作对象"
          onClick={(e) => {
            if (e.target === e.currentTarget) clear();
          }}
        >
          {doc.objects
            .filter(
              (o: any) =>
                !search ||
                objects.includes(o.id) ||
                o.name.includes(search) ||
                p.project.paths.some(
                  (path) =>
                    o.pathIds.includes(path.id) && path.name.includes(search),
                ),
            )
            .map((o: any) => {
              const open = expanded.includes(o.id),
                paths = p.project.paths.filter((path) =>
                  o.pathIds.includes(path.id),
                ),
                local =
                  scene?.cells.filter((c: any) => c.objectId === o.id) || [],
                count = local.filter((c: any) => c.painted).length,
                failed = scene?.errors.some((e: any) => e.objectId === o.id);
              return (
                <div
                  key={o.id}
                  className={
                    'creation-tree-object ' +
                    (dragTarget === o.id ? 'drop-target' : '')
                  }
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragTarget(o.id);
                  }}
                  onDragLeave={() => setDragTarget('')}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const movingData = moving.current;
                    moving.current = null;
                    setDragTarget('');
                    if (!movingData) return;
                    safely(() =>
                      movingData.paths
                        ? run('move_paths', {
                            objectId: o.id,
                            pathIds: movingData.paths,
                          })
                        : run('reorder', {
                            objectIds: movingData.objects,
                            beforeId: o.id,
                          }),
                    );
                  }}
                >
                  <div
                    role="treeitem"
                    aria-expanded={open}
                    data-tree-object={o.id}
                    aria-selected={
                      selection.kind === 'object' && objects.includes(o.id)
                    }
                    tabIndex={0}
                    className={
                      'creation-object-row ' +
                      (objects.includes(o.id)
                        ? selection.kind === 'object'
                          ? 'selected'
                          : 'contains-selection'
                        : '')
                    }
                    onClick={(e) => selectObject(o.id, e, true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectObject(o.id, e, true);
                      }
                      if (e.key === 'ArrowRight')
                        setExpanded([...new Set([...expanded, o.id])]);
                      if (e.key === 'ArrowLeft')
                        setExpanded(expanded.filter((id) => id !== o.id));
                    }}
                    draggable
                    onDragStart={(e) => {
                      const ids =
                        selection.kind === 'object' && objects.includes(o.id)
                          ? objects
                          : [o.id];
                      selectionState.commit({ kind: 'object', ids }, false);
                      moving.current = { objects: ids };
                      e.dataTransfer.setData(
                        'application/x-creation-objects',
                        JSON.stringify(ids),
                      );
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      moving.current = null;
                      setDragTarget('');
                    }}
                  >
                    <button
                      className="creation-disclosure"
                      aria-label={(open ? '折叠' : '展开') + o.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(
                          open
                            ? expanded.filter((id) => id !== o.id)
                            : [...expanded, o.id],
                        );
                      }}
                    >
                      <ChevronRight
                        size={15}
                        style={{ transform: open ? 'rotate(90deg)' : '' }}
                      />
                    </button>
                    <i
                      className="creation-object-swatch"
                      style={{
                        background:
                          local.find((c: any) => c.painted)?.color ||
                          doc.swatches.find((s: any) => s.id === o.swatchId)
                            ?.color,
                      }}
                    />
                    <Name
                      value={o.name}
                      label="重命名创作对象"
                      onRename={(name) =>
                        safely(() =>
                          run('object', { id: o.id, changes: { name } }),
                        )
                      }
                    />
                    <small
                      title={
                        failed
                          ? '分区未完成，点选部件查看恢复操作'
                          : count
                            ? '已填色的区域'
                            : '源样条，尚未填色'
                      }
                    >
                      {failed
                        ? '需检查'
                        : count
                          ? `${count} 区`
                          : `${paths.length} 线`}
                    </small>
                    <button
                      aria-label={(o.visible ? '隐藏' : '显示') + o.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        safely(() =>
                          run('object', {
                            id: o.id,
                            changes: { visible: !o.visible },
                          }),
                        );
                      }}
                    >
                      {o.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                  </div>
                  {open && (
                    <div role="group" className="creation-tree-children">
                      {paths.map((path) => (
                        <div
                          key={path.id}
                          data-tree-path={path.id}
                          className={
                            'creation-path-row ' +
                            (selection.kind === 'path' &&
                            selection.ids.includes(path.id)
                              ? 'selected'
                              : '')
                          }
                          title={`${path.closed ? '闭合' : '开放'}样条 · ${path.curves.length + (path.closed ? 0 : 1)} 个节点 · ${path.curves.length} 段贝塞尔`}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            const ids =
                              selection.kind === 'path' &&
                              selection.ids.includes(path.id)
                                ? selection.ids
                                : [path.id];
                            selectionState.commit({ kind: 'path', ids }, false);
                            moving.current = { paths: ids };
                            e.dataTransfer.setData(
                              'application/x-creation-paths',
                              JSON.stringify(ids),
                            );
                          }}
                          onDragEnd={() => {
                            moving.current = null;
                            setDragTarget('');
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const selected = selectionState.choose(
                              'path',
                              path.id,
                              e,
                            );
                            p.onFramePaths(selected.paths);
                          }}
                        >
                          <GripVertical size={12} />
                          <Name
                            value={path.name}
                            label="重命名创作线条"
                            onRename={(name) =>
                              safely(() =>
                                run('rename_path', { id: path.id, name }),
                              )
                            }
                          />
                          <small>
                            {{
                              boundary: '轮廓',
                              divider: '分区',
                              hole: '挖洞',
                              guide: '参考',
                            }[o.roles[path.id] as string] ||
                              (path.closed ? '轮廓' : '参考')}
                          </small>
                          <button
                            aria-label={'编辑线条 ' + path.name}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectionState.selectPaths([path.id]);
                              p.onFramePaths([path.id]);
                              p.onTool('edit');
                              setTab('lines');
                            }}
                          >
                            <Pencil size={13} />
                          </button>
                        </div>
                      ))}
                      {local.length > 0 && (
                        <details
                          open={expandedCells.includes(o.id)}
                          onToggle={(e) => {
                            const open = e.currentTarget.open;
                            setExpandedCells((ids) =>
                              open
                                ? [...new Set([...ids, o.id])]
                                : ids.filter((id) => id !== o.id),
                            );
                          }}
                        >
                          <summary>内部区域 · {local.length}</summary>
                          <div className="creation-cell-list">
                            {local.map((c: any) => (
                              <button
                                key={c.key}
                                data-tree-cell={c.key}
                                aria-label={regionLabel(c, rendered)}
                                title={`${regionLabel(c, rendered)}${!c.painted ? ' · 待启用' : ''}`}
                                aria-pressed={cellKeys.includes(c.key)}
                                onClick={(e) => {
                                  const selected = selectionState.choose(
                                    'cell',
                                    c.key,
                                    e,
                                  );
                                  p.onFramePaths(selected.paths);
                                }}
                                style={{ borderBottomColor: c.color }}
                              >
                                <span>{regionLabel(c, rendered)}</span>
                              </button>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          {!doc.objects.length && (
            <div className="creation-empty">
              先描一段轮廓，或打开已有工程。
              <button onClick={p.onNewPath}>
                <Pencil size={16} />
                开始描线
              </button>
            </div>
          )}
        </div>
        <div className="creation-tabs" role="tablist" aria-label="创作属性">
          {[
            ['object', '颜色与高低'],
            ['lines', '线条'],
            ['modifiers', '修改器'],
            ['make', '制作'],
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
        <div className="creation-properties" role="tabpanel">
          {tab === 'modifiers' && (
            <CreationModifiers
              key={current?.id || 'none'}
              object={current}
              project={p.project}
              scene={scene}
              busy={calculating || revision.current !== p.project}
              cellKeys={selection.kind === 'cell' ? selection.ids : []}
              onLocate={(ids) => {
                selectionState.selectPaths(ids);
                p.onView('flat');
                p.onTool('edit');
                p.onFramePaths(ids, { force: true });
              }}
              onCommand={(action: string, args: any) =>
                safely(() => run(action, args))
              }
            />
          )}
          {error && (
            <div role="alert" className="creation-error">
              {error}
              <button aria-label="关闭错误提示" onClick={() => setError('')}>
                <X size={14} />
              </button>
            </div>
          )}
          {[
            ...(scene?.errors || []).filter((e: any) =>
              objects.includes(e.objectId),
            ),
            ...(roleIssue && objects.includes(roleIssue.objectId)
              ? [{ ...roleIssue, pending: true }]
              : []),
          ].map((e: any, i: number) => {
            const owner = doc.objects.find((o: any) => o.id === e.objectId);
            if (e.kind === 'pipeline' && !e.modifierId)
              return (
                <ConstructionPipeline
                  key={i}
                  object={owner}
                  scene={scene}
                  busy={calculating || p.busy}
                  onCommand={(action, args) => safely(() => run(action, args))}
                  onLocate={(ids) => {
                    selectionState.selectPaths(ids);
                    p.onView('flat');
                    p.onTool('edit');
                    p.onFramePaths(ids, { force: true });
                  }}
                />
              );
            if (e.kind === 'modifier' || e.modifierId) {
              const inline = scene?.modifierStatus?.some(
                (status: any) => status.objectId === e.objectId && status.error,
              );
              if (tab === 'modifiers' && inline) return null;
              return (
                <div key={i} role="alert" className="creation-error">
                  <strong>{owner?.name || '当前部件'} · 产出链已暂停</strong>
                  <p>{e.message}</p>
                  {tab !== 'modifiers' && (
                    <button onClick={() => setTab('modifiers')}>
                      查看修改器
                    </button>
                  )}
                </div>
              );
            }
            const candidates =
              e.pathIds ||
              owner?.pathIds.filter((id: string) =>
                ['divider', 'hole'].includes(owner.roles[id]),
              ) ||
              [];
            const selected =
              selection.kind === 'path'
                ? selection.ids.filter((id) => candidates.includes(id))
                : [];
            const ids = selected.length ? selected : candidates.slice(-1);
            return (
              <CreationIssue
                key={i}
                name={owner?.name || '当前部件'}
                message={e.message}
                pending={e.pending}
                pathNames={ids.map(
                  (id: string) =>
                    p.project.paths.find((path) => path.id === id)?.name ||
                    '分区线',
                )}
                busy={calculating || checkingRole || p.busy}
                onLocate={() => {
                  selectionState.selectPaths(ids);
                  p.onView('flat');
                  p.onTool('edit');
                  p.onFramePaths(ids, { force: true });
                }}
                onDisable={
                  !e.pending && ids.length
                    ? () =>
                        safely(() =>
                          applyRoles({
                            objectId: owner.id,
                            pathIds: ids,
                            role: 'guide',
                          }),
                        )
                    : undefined
                }
                onRetry={
                  !e.pending
                    ? () =>
                        safely(async () => {
                          const snapshot = ref.current.project;
                          const result = await call('creation', {}, snapshot);
                          if (ref.current.project !== snapshot) return;
                          setScene(result);
                          sceneRef.current = result;
                          revision.current = snapshot;
                        })
                    : undefined
                }
              />
            );
          })}
          {tab === 'object' && (
            <>
              {current ? (
                <>
                  <CreationSelectionDetails
                    selection={selection}
                    objects={objects}
                    project={p.project}
                    scene={scene}
                    onSelect={(next) => selectionState.commit(next)}
                    onEnable={() => safely(() => applyHeight(displayedHeight))}
                    onEdit={() => {
                      const ids =
                        selection.kind === 'cell'
                          ? pathsForRegions(p.project, scene, cellKeys)
                          : current.pathIds;
                      selectionState.selectPaths(ids);
                      p.onTool('edit');
                      setTab('lines');
                    }}
                  />
                  {scope === 'object' && (
                    <div className="creation-draw-actions">
                      <button
                        onClick={() => {
                          nextRole.current = 'boundary';
                          p.onView('flat');
                          p.onNewPath();
                          setTab('lines');
                        }}
                      >
                        画轮廓
                      </button>
                      <button
                        onClick={() =>
                          safely(() => {
                            nextRole.current = 'divider';
                            p.onView('flat');
                            p.onNewPath();
                            setTab('lines');
                          })
                        }
                      >
                        画分区线
                      </button>
                      <button
                        onClick={() =>
                          safely(() => {
                            nextRole.current = 'hole';
                            p.onView('flat');
                            p.onNewPath();
                            setTab('lines');
                          })
                        }
                      >
                        画挖洞轮廓
                      </button>
                    </div>
                  )}
                  {sourceOnly && (
                    <p className="creation-source-note">
                      仅有线条 · 尚未构面。开放样条不会单独产生色块；
                      可以继续闭合轮廓，或移入已有部件作分区、参考。
                    </p>
                  )}
                  {objects.length > 1 && (
                    <button
                      onClick={() =>
                        safely(() =>
                          run('combine_objects', { objectIds: objects }),
                        )
                      }
                    >
                      整理为一个部件
                    </button>
                  )}
                  {scope !== 'source' && (
                    <>
                      {scope === 'object' ? (
                        <PrintPlacement
                          doc={doc}
                          scene={scene}
                          objectIds={objects}
                          disabled={calculating || p.busy}
                          onCommand={(a, args) => safely(() => run(a, args))}
                          onManage={() => setTab('make')}
                        />
                      ) : (
                        printHeight && (
                          <p className="creation-muted">
                            {
                              doc.printStack.layers.find(
                                (l: any) => l.id === current?.printLayerId,
                              )?.name
                            }{' '}
                            · 从 {cell?.bottomMM ?? 0} mm 开始，跟随下层抬升
                          </p>
                        )
                      )}
                      <CreationColor
                        key={JSON.stringify(selection)}
                        label={
                          sourceOnly
                            ? '默认颜色'
                            : scope === 'local'
                              ? `区域颜色 · ${cellKeys.length} 区`
                              : '部件颜色'
                        }
                        colors={
                          sourceOnly
                            ? [
                                doc.swatches.find(
                                  (s: any) => s.id === current.swatchId,
                                )?.color || swatch.color,
                              ]
                            : (scene?.cells || [])
                                .filter((c: any) =>
                                  scope === 'local'
                                    ? cellKeys.includes(c.key)
                                    : objects.includes(c.objectId),
                                )
                                .map((c: any) => c.color)
                        }
                        swatches={doc.swatches}
                        disabled={calculating || p.busy || failedSelection}
                        onPaint={(args) =>
                          safely(() => run('paint', { ...targets(), ...args }))
                        }
                      />
                      <div className="creation-property-block">
                        <label>
                          {scope === 'object' ? '部件统一厚度' : '区域厚度'}{' '}
                          <span>{printHeight ? '打印层' : 'mm'}</span>
                        </label>
                        <div className="creation-height-input">
                          <NumberEdit
                            key={JSON.stringify(selection)}
                            label={printHeight ? '厚度打印层数' : '凸起厚度'}
                            disabled={calculating || failedSelection}
                            value={displayedHeight}
                            min={heightMinimum}
                            max={heightMaximum}
                            step={printHeight ? 1 : 0.1}
                            onCommit={(n) => safely(() => applyHeight(n))}
                          />
                          <button
                            aria-pressed={p.tool === 'height'}
                            disabled={calculating || failedSelection}
                            onClick={() => p.onTool('height')}
                          >
                            <ArrowUpFromLine size={17} />
                            拖动调高
                          </button>
                        </div>
                        <input
                          aria-label="调整凸起厚度"
                          disabled={calculating || failedSelection}
                          type="range"
                          min={printHeight ? 1 : 0.1}
                          max={Math.max(printHeight ? 30 : 6, displayedHeight)}
                          step={printHeight ? 1 : 0.1}
                          value={displayedHeight}
                          onPointerDown={() => {
                            heightDrag.current = { slider: true };
                          }}
                          onChange={(e) => setDraftHeight(+e.target.value)}
                          onPointerUp={() => {
                            heightDrag.current = null;
                            const value = draftHeight;
                            setDraftHeight(null);
                            if (value !== null)
                              safely(() => applyHeight(value));
                          }}
                          onPointerCancel={cancel}
                          onKeyUp={(e) => {
                            if (e.key === 'Escape') {
                              cancel();
                              return;
                            }
                            if (draftHeight !== null) {
                              const n = draftHeight;
                              setDraftHeight(null);
                              safely(() => applyHeight(n));
                            }
                          }}
                        />
                        {printHeight && (
                          <small>
                            {displayedHeight} × {printHeight} mm ={' '}
                            {printMM(displayedHeight, printHeight)} mm
                          </small>
                        )}
                      </div>
                    </>
                  )}
                  {scope === 'object' && (
                    <details className="creation-position">
                      <summary>
                        {printHeight ? '成品选项' : '部件位置与叠放'}
                      </summary>
                      {!printHeight && (
                        <>
                          <label>
                            起始高度 mm
                            <NumberEdit
                              label="对象起始高度"
                              value={current.zMM}
                              onCommit={(n) =>
                                safely(() =>
                                  run('object', {
                                    id: current.id,
                                    changes: { zMM: n },
                                  }),
                                )
                              }
                            />
                          </label>
                          <label>
                            放到对象上
                            <select
                              aria-label="放到对象上"
                              value={current.attachId || ''}
                              onChange={(e) =>
                                safely(() =>
                                  run('object', {
                                    id: current.id,
                                    changes: { attachId: e.target.value },
                                  }),
                                )
                              }
                            >
                              <option value="">平台 · Z = 0</option>
                              {doc.objects
                                .filter((o: any) => o.id !== current.id)
                                .map((o: any) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <small>
                            列表拖动只调整顺序；这里才会改变物理高度。
                          </small>
                        </>
                      )}
                      <label>
                        <input
                          type="checkbox"
                          checked={current.printable}
                          onChange={(e) =>
                            safely(() =>
                              run('object', {
                                id: current.id,
                                changes: { printable: e.target.checked },
                              }),
                            )
                          }
                        />
                        参与成品导出
                      </label>
                    </details>
                  )}
                </>
              ) : (
                <div className="creation-empty">
                  <Layers size={24} />
                  <b>描轮廓，填颜色，调高低</b>
                  <p>
                    点击面选区域，点击线选样条。右侧同步定位；空白处或 Esc
                    取消选择。
                  </p>
                  <button onClick={() => p.onTool('paint')}>
                    <PaintBucket size={16} />
                    给闭合轮廓上色
                  </button>
                </div>
              )}
              <div className="creation-project-color">
                <button
                  aria-expanded={editingSwatch}
                  onClick={() => setEditingSwatch(!editingSwatch)}
                >
                  <i style={{ background: swatch.color }} />
                  修改项目色 · {swatch.name}
                  <ChevronRight size={14} />
                </button>
                {editingSwatch && (
                  <div>
                    <p>引用这枚色卡的区域会一起改变。</p>
                    <Name
                      value={swatch.name}
                      label="重命名项目色"
                      onRename={(name) =>
                        safely(() =>
                          run('swatch', {
                            id: swatch.id,
                            name,
                            color: swatch.color,
                          }),
                        )
                      }
                    />
                    <input
                      type="color"
                      aria-label="项目色色值"
                      defaultValue={swatch.color}
                      key={swatch.id + swatch.color}
                      onBlur={(e) => {
                        if (e.target.value !== swatch.color)
                          safely(() =>
                            run('swatch', {
                              id: swatch.id,
                              color: e.target.value,
                            }),
                          );
                      }}
                    />
                    <button
                      onClick={() =>
                        safely(async () => {
                          if (!(window as any).EyeDropper)
                            throw Error(
                              '此浏览器不支持屏幕取色，请使用色值输入',
                            );
                          try {
                            const value = await new (
                              window as any
                            ).EyeDropper().open();
                            run('swatch', {
                              id: swatch.id,
                              color: value.sRGBHex,
                            });
                          } catch (e: any) {
                            if (e.name !== 'AbortError') throw e;
                          }
                        })
                      }
                    >
                      <Pipette size={15} />
                      取色
                    </button>
                    <CreationSwatchDelete
                      key={swatch.id}
                      creation={doc}
                      swatch={swatch}
                      disabled={p.busy || calculating}
                      onDelete={(replacementId) => {
                        const next = run('delete_swatch', {
                          id: swatch.id,
                          replacementId,
                        });
                        setBrush(replacementId || next.creation.swatches[0].id);
                        notify('项目色已删除 · Ctrl+Z 撤销');
                      }}
                    />
                  </div>
                )}
              </div>
            </>
          )}
          {tab === 'lines' && (
            <>
              <div className="creation-property-title">
                <b>线条编辑</b>
                <button onClick={p.onNewPath}>
                  <Plus size={14} />
                  新线条
                </button>
              </div>
              <div className="creation-source-settings">
                {p.sourceInspector}
              </div>
              {current &&
                selection.kind === 'path' &&
                p.selectedPaths.some((id) => current.pathIds.includes(id)) && (
                  <div className="creation-role">
                    <label>选中线条的用途</label>
                    <div>
                      {[
                        ['boundary', '轮廓'],
                        ['divider', '分区'],
                        ['hole', '挖洞'],
                        ['guide', '参考'],
                      ].map(([role, label]) => (
                        <button
                          key={role}
                          disabled={checkingRole || calculating || p.busy}
                          aria-pressed={p.selectedPaths
                            .filter((id) => current.pathIds.includes(id))
                            .every(
                              (id) =>
                                (current.roles[id] ||
                                  (p.project.paths.find(
                                    (path) => path.id === id,
                                  )?.closed
                                    ? 'boundary'
                                    : 'guide')) === role,
                            )}
                          onClick={() => chooseRole(role)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <small>
                      分区保留共享边界；挖洞使用闭合线。参考线不参与填色。
                    </small>
                    {checkingRole && (
                      <p role="status">正在检查分区，完成后应用…</p>
                    )}
                    {roleResult?.objectId === current.id && (
                      <p role="status" className="creation-role-result">
                        {roleResult.message}
                      </p>
                    )}
                  </div>
                )}
              {current && (
                <CreationConnections
                  key={current.id}
                  object={current}
                  scene={scene}
                  project={p.project}
                  preview={joinPreview}
                  onCancel={clearConnectionPreview}
                  onModifiers={() => setTab('modifiers')}
                  onPreview={(joinMM) =>
                    safely(async () => {
                      const snapshot = p.project,
                        id = current.id,
                        token = ++connectionRequest.current;
                      const result = await call('creation', {
                        objectId: id,
                        joinMM,
                      });
                      if (
                        token !== connectionRequest.current ||
                        focusedObject.current !== id
                      )
                        return;
                      if (ref.current.project !== snapshot)
                        throw Error('来源已变化，请重新预览');
                      setJoinPreview(result);
                      setConnectionHighlight([]);
                    })
                  }
                  onApply={(joinMM) =>
                    safely(() => run('join', { objectId: current.id, joinMM }))
                  }
                  onCommand={(action, args) => safely(() => run(action, args))}
                  onLocate={(ids, connections = []) => {
                    selectionState.selectPaths(ids);
                    p.onView('flat');
                    p.onFramePaths(ids, { force: true });
                    setConnectionHighlight(connections);
                  }}
                />
              )}
            </>
          )}
          {tab === 'make' && (
            <>
              <PrintStack
                doc={doc}
                scene={scene}
                objectIds={objects}
                disabled={calculating || p.busy}
                onCommand={(action, args) => safely(() => run(action, args))}
              />
              <div className="creation-property-title">
                <b>制作成品</b>
                <span>毫米</span>
              </div>
              <label className="creation-dimension">
                作品宽度
                <NumberEdit
                  label="创作作品宽度"
                  value={p.project.widthMM}
                  min={0.1}
                  max={10000}
                  onCommit={(n) => {
                    p.onProject({ ...p.project, widthMM: n });
                    notify('已调整作品比例');
                  }}
                />
              </label>
              <details className="creation-base">
                <summary>生成承托部件 · 可选</summary>
                <p className="creation-muted">
                  已有完整底层轮廓时无需添加。此工具只根据所选部件的外形生成新的承托部件，可在普通修改器中继续编辑。
                </p>
                <label>
                  外扩边距 mm
                  <NumberEdit
                    label="底板外扩边距"
                    value={baseMargin}
                    min={0}
                    max={20}
                    onCommit={(n) => {
                      setBaseMargin(n);
                      setBasePreview(null);
                    }}
                  />
                </label>
                <label>
                  底板厚度 {printHeight ? '打印层' : 'mm'}
                  <NumberEdit
                    label="底板厚度"
                    value={
                      printHeight
                        ? printCount(baseHeight, printHeight)
                        : baseHeight
                    }
                    min={printHeight ? 1 : 0.1}
                    max={heightMaximum}
                    step={printHeight ? 1 : 0.1}
                    onCommit={(n) => {
                      setBaseHeight(printHeight ? printMM(n, printHeight) : n);
                      setBasePreview(null);
                    }}
                  />
                </label>
                <button
                  disabled={!objects.length || calculating}
                  onClick={() =>
                    safely(async () => {
                      const snapshot = p.project;
                      const result = await call('creation_base', {
                        objectIds: objects,
                        offsetMM: baseMargin,
                        ...(printHeight
                          ? {
                              heightLayers: printCount(baseHeight, printHeight),
                            }
                          : { heightMM: baseHeight }),
                        swatchId: swatch.id,
                      });
                      if (ref.current.project !== snapshot)
                        throw Error('来源已变化，请重新预览');
                      setBasePreview({
                        ...result,
                        project: { ...result.project, image: snapshot.image },
                        revision: snapshot,
                      });
                    })
                  }
                >
                  预览底板
                </button>
                <small>
                  {printHeight
                    ? '采用当前画笔色。底板会占据新的最底层，现有层整体抬升。'
                    : '采用当前画笔色。确认后所选部件放到底板顶面。'}
                </small>
              </details>
              <p className="creation-muted">
                {printHeight
                  ? '同层轮廓仍需自行分区或布尔处理；分层只安排竖直位置。高低不齐的层叠放后，可检查上层是否有悬空。'
                  : '已有底层轮廓可直接承托；在“位置与叠放”设置上下关系后检查实体。'}
              </p>
              <button
                className="creation-wide"
                disabled={exporting || calculating}
                onClick={() => safely(() => exportWork('check'))}
              >
                {exporting ? '正在检查…' : '检查可打印实体'}
              </button>
              {report && (
                <div className="creation-report">
                  <b>
                    {report.report.valid && report.report.components === 1
                      ? '实体检查通过'
                      : '需要调整连接'}
                  </b>
                  <p>
                    {report.report.components} 个连通实体 ·{' '}
                    {report.report.triangles} 个三角面
                  </p>
                  <p>体积 {report.report.volumeMM3?.toFixed(1)} mm³</p>
                  {report.warnings.map((w: string, i: number) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              )}
              <div className="creation-export">
                <button
                  disabled={exporting}
                  onClick={() => safely(() => exportWork('3mf'))}
                >
                  <Download size={16} />
                  导出 3MF
                </button>
                <button
                  disabled={exporting}
                  onClick={() => safely(() => exportWork('blender'))}
                >
                  Blender · 实体与源线
                </button>
                <button
                  disabled={calculating}
                  onClick={() => safely(() => exportWork('svg'))}
                >
                  分色 SVG
                </button>
              </div>
              <p className="model-help">
                通用 3MF
                保留分色部件、尺寸和位置，不绑定打印机。打印机、耗材与切片参数在切片软件中选择；部分软件需重新指定部件颜色。
              </p>
              <SlicerTemplate
                onExport={() => safely(() => exportWork('3mf-bambu'))}
                value={p.project.model?.slicerTemplate}
                disabled={exporting}
                onChange={(slicerTemplate) =>
                  p.onProject({
                    ...p.project,
                    model: { ...p.project.model, slicerTemplate },
                  })
                }
              />
              <details className="creation-advanced">
                <summary>高级构造与制造参数</summary>
                <p>已有布尔、两线围面、切削和零件定义保留在构造记录中。</p>
                <button onClick={() => p.onAdvanced('faces')}>构造记录</button>
                <button onClick={() => p.onAdvanced('relief')}>
                  实体与制造参数
                </button>
              </details>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
