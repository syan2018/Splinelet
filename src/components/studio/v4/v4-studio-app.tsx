'use client';
import { useEffect, useRef, useState } from 'react';
import { createDocument } from '@/lib/document/schema.mjs';
import type { DocumentV4, EntityRef, OutputRef } from '@/lib/document/types';
import { createEditorSession } from '@/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '@/lib/editing/commands/authoring.mjs';
import {
  createEvaluationSession,
  createWorkerClient,
} from '@/lib/evaluation/session.mjs';
import { projectEditor } from '@/lib/editor/projection.mjs';
import { exportSnapshot } from '@/lib/export/snapshot.mjs';
import { openProject } from '@/lib/persistence/open-project.mjs';
import { createV4PersistenceSession } from '@/lib/persistence/v4-session.mjs';
import { createV4DraftStore } from '@/lib/persistence/v4-drafts.mjs';
import {
  saveThroughRuntime,
  isDesktopRuntime,
  desktopProjectSavePath,
  desktopWriteProject,
} from '@/lib/platform/index.mjs';
import * as documentWorkerModule from '@/lib/evaluation/document-worker.ts?worker';
import { V4Canvas } from '@/components/source-editor/v4/v4-canvas';
import type { V4CanvasAction } from '@/hooks/use-v4-canvas-gestures';
import { createV4AgentAPI } from '@/lib/agent/v4-api.mjs';
import { V4BodyPreview, type BodyPreview } from './v4-body-preview';

const emptySelection = () => ({
  scope: 'objects',
  entityRefs: [] as EntityRef[],
  activeRef: null as EntityRef | null,
});
const newDocument = () => {
  const document = createDocument();
  for (const [id, name, color] of [
    ['red', '红色', '#e55353'],
    ['blue', '蓝色', '#4d9fff'],
    ['white', '白色', '#eeeeee'],
    ['black', '黑色', '#202020'],
  ])
    document.appearances.swatches[id] = { id, name, color };
  return document;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export default function V4StudioApp() {
  const [editor] = useState(() => createEditorSession(newDocument()));
  const [state, setState] = useState(editor.state);
  const [selection, setSelection] = useState(emptySelection);
  const [tool, setTool] = useState<'select' | 'move' | 'pen'>('pen');
  const [details, setDetails] = useState(false);
  const [drawIntent, setDrawIntent] = useState<'partition' | 'hole' | null>(
    null,
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [projection, setProjection] = useState(() =>
    projectEditor(state.document),
  );
  const [busy, setBusy] = useState(false);
  const [bodyPreview, setBodyPreview] = useState<BodyPreview | null>(null);
  const evaluation = useRef<ReturnType<typeof createEvaluationSession> | null>(
    null,
  );
  const [files] = useState(() =>
    createV4PersistenceSession({
      drafts: createV4DraftStore(),
      writeFile: async (target: string, bytes: Uint8Array) => {
        if (isDesktopRuntime()) await desktopWriteProject(target, bytes);
        else
          await saveThroughRuntime(
            bytes,
            target,
            'application/vnd.splinelet.project+zip',
          );
      },
    }),
  );
  const opening = useRef(false);
  const document = (state.preview?.document || state.document) as DocumentV4;
  const active = selection.activeRef;
  const target = active?.kind === 'output' ? (active as OutputRef) : null;
  const regionDefinition = target
    ? {
        ...document.reliefDefinitions.defaults[target.ownerNodeId],
        ...Object.values(document.reliefDefinitions.overrides).find(
          (item) => JSON.stringify(item.target) === JSON.stringify(target),
        )?.value,
      }
    : null;
  const thickness = regionDefinition?.thickness || { kind: 'mm', value: 1 };
  const nodeIds = selection.entityRefs.flatMap((ref) =>
    ref.kind === 'node' ? [ref.id] : [],
  );
  const ownerNodeId =
    nodeIds.length === 1 && document.nodes[nodeIds[0]]?.kind === 'shape'
      ? nodeIds[0]
      : undefined;
  const run = (action: V4CanvasAction | Record<string, unknown>) => {
    if (action.kind === 'select-candidate') {
      const ref = action.target as OutputRef;
      setSelection({ scope: 'regions', entityRefs: [ref], activeRef: ref });
      return;
    }
    try {
      const request =
        action.kind === 'draw-path' && drawIntent
          ? {
              ...action,
              kind: drawIntent === 'hole' ? 'draw-hole' : 'draw-partition',
              targets: target ? [target] : [],
            }
          : action;
      editor.dispatch(createAuthoringCommand(request), {
        expectedRevision: editor.state.revision,
      });
      if (drawIntent && action.kind === 'draw-path') {
        setDrawIntent(null);
        setTool('select');
      }
      setError('');
    } catch (reason) {
      setError(message(reason));
    }
  };
  useEffect(() => {
    files.open({
      kind: 'v4',
      document: editor.state.document,
      assets: {},
      epoch: editor.state.epoch,
    });
    const WorkerConstructor = (
      documentWorkerModule as unknown as { default: new () => Worker }
    ).default;
    const worker = new WorkerConstructor();
    const client = createWorkerClient(worker);
    const session = createEvaluationSession({
      workerClient: client,
      capabilities: ['curves', 'regions', 'relief', 'placed-relief', 'bodies'],
    });
    evaluation.current = session;
    const api = createV4AgentAPI({
      editorSession: editor,
      evaluationSession: session,
      evaluationCapabilities: [
        'curves',
        'regions',
        'relief',
        'placed-relief',
        'bodies',
      ],
      exportFormats: [
        { format: 'stl', stage: 'bodies' },
        { format: '3mf', stage: 'bodies' },
      ],
    });
    const host = window as unknown as { traceStudioV4?: typeof api };
    host.traceStudioV4 = api;
    let alive = true,
      generation = 0;
    let draftTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (next: typeof state) => {
      const current = ++generation;
      clearTimeout(draftTimer);
      setState(next);
      setBodyPreview(null);
      const shown = next.preview?.document || next.document;
      setProjection(projectEditor(shown));
      session.update(next);
      if (next.previewId === null) {
        if (files.state.epoch !== next.epoch)
          files.open({
            kind: 'v4',
            document: next.document,
            assets: {},
            epoch: next.epoch,
          });
        files.update(next);
        if (next.lastChange && !opening.current) {
          setDraftStatus('正在保存草稿…');
          clearTimeout(draftTimer);
          draftTimer = setTimeout(() => {
            void files
              .autosave({
                expectedEpoch: next.epoch,
                expectedRevision: next.revision,
              })
              .then(() => {
                if (
                  alive &&
                  editor.state.epoch === next.epoch &&
                  editor.state.revision === next.revision
                )
                  setDraftStatus('草稿已保存');
              })
              .catch((reason: unknown) => {
                if (alive) setError(message(reason));
              });
          }, 300);
        }
        if (next.lastChange?.selectionIntent)
          setSelection(next.lastChange.selectionIntent);
      }
      setBusy(true);
      void session
        .request({ domains: ['curves', 'regions'] })
        .then(() => {
          if (!alive || generation !== current) return;
          const result = (
            Object.values(session.state.results) as {
              status: string;
              snapshot: { planar: Parameters<typeof projectEditor>[1] };
            }[]
          ).find((result) => result.status === 'ready');
          if (result)
            setProjection(projectEditor(shown, result.snapshot.planar));
          setBusy(false);
        })
        .catch((reason: unknown) => {
          if (alive && generation === current) {
            setError(message(reason));
            setBusy(false);
          }
        });
    };
    refresh(editor.state);
    const off = editor.subscribe(refresh);
    return () => {
      alive = false;
      clearTimeout(draftTimer);
      off();
      session.dispose();
      client.close();
      worker.terminate();
      evaluation.current = null;
      if (host.traceStudioV4 === api) delete host.traceStudioV4;
    };
  }, [editor, files]);
  const preview = {
    onPreviewStart: () =>
      editor.beginPreview({ expectedRevision: editor.state.revision }),
    onPreviewUpdate: (action: V4CanvasAction) => {
      try {
        editor.updatePreview(createAuthoringCommand(action), {
          expectedRevision: editor.state.revision,
          previewId: editor.state.previewId,
        });
      } catch (reason) {
        setError(message(reason));
      }
    },
    onPreviewCommit: () => {
      if (editor.state.previewId)
        editor.commitPreview({
          expectedRevision: editor.state.revision,
          previewId: editor.state.previewId,
        });
    },
    onPreviewCancel: () => {
      if (editor.state.previewId)
        editor.cancelPreview({
          expectedRevision: editor.state.revision,
          previewId: editor.state.previewId,
        });
    },
  };
  const open = async (file: File) => {
    const before = editor.state;
    try {
      const opened = openProject({
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (
        editor.state.epoch !== before.epoch ||
        editor.state.revision !== before.revision
      )
        throw Error('读取期间工程已改变，请重新打开');
      opening.current = true;
      const next = editor.replaceDocument(opened.document, {
        expectedRevision: before.revision,
      });
      files.open({ ...opened, epoch: next.epoch });
      files.update(next);
      opening.current = false;
      setSelection(emptySelection());
      setNotice(
        opened.kind === 'legacy'
          ? '旧工程已导入，首次保存将另存为 V4 文件'
          : '工程已打开',
      );
      setError('');
    } catch (reason) {
      opening.current = false;
      setError(message(reason));
    }
  };
  const restore = async () => {
    const current = editor.state;
    try {
      const draft = await files.restore({ expectedEpoch: current.epoch });
      if (!draft) {
        setNotice('没有可恢复的草稿');
        return;
      }
      if (editor.state.revision !== current.revision)
        throw Error('恢复期间工程已改变');
      opening.current = true;
      const next = editor.replaceDocument(draft.document, {
        expectedRevision: current.revision,
      });
      files.open({
        kind: 'v4',
        document: draft.document,
        assets: draft.assets,
        epoch: next.epoch,
      });
      files.update(next);
      setSelection(emptySelection());
      setNotice('草稿已恢复');
    } catch (reason) {
      setError(message(reason));
    } finally {
      opening.current = false;
    }
  };
  const save = async () => {
    try {
      const current = editor.state;
      const target = isDesktopRuntime()
        ? await desktopProjectSavePath('作品-v4.spl')
        : '作品-v4.spl';
      if (typeof target !== 'string' || !target) return;
      await files.save({
        expectedEpoch: current.epoch,
        expectedRevision: current.revision,
        previewId: current.previewId,
        saveAsTarget: target,
      });
      setNotice('工程已保存');
      setError('');
    } catch (reason) {
      setError(message(reason));
    }
  };
  const exportBody = async () => {
    const session = evaluation.current;
    if (!session) return;
    try {
      const current = editor.state;
      await session.request({ domains: ['bodies'] });
      const captured = session.capture({
        epoch: current.epoch,
        revision: current.revision,
        domains: ['bodies'],
      });
      const result = await exportSnapshot(captured, {
        format: 'stl',
        stage: 'bodies',
      });
      await saveThroughRuntime(result.data, '作品.stl', result.mimeType);
      setNotice('实体已导出');
      setError('');
    } catch (reason) {
      setError(message(reason));
    }
  };
  const showBody = async () => {
    const session = evaluation.current;
    if (!session) return;
    const current = editor.state;
    try {
      await session.request({ domains: ['bodies'] });
      const captured = session.capture({
        epoch: current.epoch,
        revision: current.revision,
        domains: ['bodies'],
      });
      setBodyPreview(captured.snapshot.bodies as BodyPreview);
    } catch (reason) {
      setError(message(reason));
    }
  };
  return (
    <main
      style={{
        height: '100dvh',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        background: '#11151e',
        color: '#eee',
      }}
      data-editor-model="v4"
    >
      <header
        style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'center' }}
      >
        <strong>Splinelet</strong>
        <button onClick={() => void restore()}>恢复草稿</button>
        <button onClick={() => void showBody()}>预览成品</button>
        <button
          onClick={() => {
            editor.replaceDocument(newDocument(), {
              expectedRevision: editor.state.revision,
            });
            setSelection(emptySelection());
          }}
        >
          新建
        </button>
        <label>
          打开
          <input
            aria-label="打开工程"
            type="file"
            accept=".spl,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void open(file);
              event.target.value = '';
            }}
          />
        </label>
        <button onClick={() => void save()}>保存</button>
        <button
          disabled={!state.canUndo}
          onClick={() =>
            editor.undo({ expectedRevision: editor.state.revision })
          }
        >
          撤销
        </button>
        <button
          disabled={!state.canRedo}
          onClick={() =>
            editor.redo({ expectedRevision: editor.state.revision })
          }
        >
          重做
        </button>
        <button onClick={() => void exportBody()}>导出 STL</button>
      </header>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '200px minmax(0,1fr) 240px',
          minHeight: 0,
        }}
      >
        <aside aria-label="部件" style={{ padding: 12, overflow: 'auto' }}>
          <h2>部件</h2>
          {Object.values(document.nodes)
            .sort((a, b) => a.order - b.order)
            .map((node) => (
              <button
                key={node.id}
                style={{ display: 'block', marginTop: 8 }}
                aria-pressed={nodeIds.includes(node.id)}
                onClick={() =>
                  setSelection({
                    scope: 'objects',
                    entityRefs: [{ kind: 'node', id: node.id }],
                    activeRef: { kind: 'node', id: node.id },
                  })
                }
              >
                {node.name}
              </button>
            ))}
          {!Object.keys(document.nodes).length && (
            <p>在画布上画线，开始一个部件。</p>
          )}
        </aside>
        <section
          style={{
            display: 'grid',
            gridTemplateRows: bodyPreview
              ? 'auto minmax(0,1fr) minmax(0,1fr)'
              : 'auto minmax(0,1fr)',
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <nav style={{ display: 'flex', gap: 8, padding: 8 }}>
            {(
              [
                ['pen', '画线'],
                ['select', '选择'],
                ['move', '移动'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={tool === value}
                onClick={() => {
                  setTool(value);
                  setDrawIntent(null);
                }}
              >
                {label}
              </button>
            ))}
            <button
              disabled={!target}
              onClick={() => {
                setDrawIntent('partition');
                setTool('pen');
              }}
            >
              分区
            </button>
            <button
              disabled={!target}
              onClick={() => {
                setDrawIntent('hole');
                setTool('pen');
              }}
            >
              挖孔
            </button>
          </nav>
          <V4Canvas
            document={document}
            projection={projection}
            selection={selection}
            tool={tool}
            nodeIds={nodeIds}
            ownerNodeId={ownerNodeId}
            onAction={run}
            {...preview}
          />
          {bodyPreview && <V4BodyPreview stage={bodyPreview} />}
        </section>
        <aside style={{ padding: 12, overflow: 'auto' }}>
          <h2>颜色</h2>
          <p>{target ? '给当前区域上色' : '点击画布中的区域后上色'}</p>
          {Object.values(document.appearances.swatches).map((swatch) => (
            <button
              key={swatch.id}
              aria-label={`颜色 ${swatch.name}`}
              disabled={!target}
              style={{
                background: swatch.color,
                width: 32,
                height: 32,
                margin: 4,
                border: '1px solid #999',
              }}
              onClick={() =>
                run({ kind: 'paint-region', target, swatchId: swatch.id })
              }
            />
          ))}
          <h2>厚度</h2>
          <label>
            {thickness.kind === 'mm' ? '毫米' : '层数'}
            <input
              key={`${JSON.stringify(target)}:${state.revision}`}
              aria-label={
                thickness.kind === 'mm' ? '厚度（毫米）' : '厚度（层数）'
              }
              type="number"
              min="0.01"
              step="0.1"
              defaultValue={
                thickness.kind === 'mm' ? thickness.value : thickness.count
              }
              disabled={!target}
              onBlur={(event) => {
                if (target)
                  run({
                    kind: 'set-thickness',
                    target,
                    thickness:
                      thickness.kind === 'mm'
                        ? { kind: 'mm', value: Number(event.target.value) }
                        : { kind: 'layers', count: Number(event.target.value) },
                  });
              }}
            />
          </label>
          <button
            onClick={() => setDetails((value) => !value)}
            aria-expanded={details}
          >
            高级详情
          </button>
          {details && (
            <div>
              <p>构造与制造信息</p>
              {Object.values(document.programs).map((program) => (
                <p key={program.id}>
                  {document.nodes[program.ownerNodeId].name}：
                  {Object.values(program.operators)
                    .map((operator) => operator.name)
                    .join(' → ')}
                </p>
              ))}
            </div>
          )}
          {projection.details.diagnostics.map((diagnostic, index) => (
            <p key={index} role="alert">
              {diagnostic.message}
            </p>
          ))}
        </aside>
      </div>
      <footer style={{ padding: 8 }}>
        <span aria-label="恢复草稿状态">{draftStatus}</span>{' '}
        {error ? (
          <span role="alert">{error}</span>
        ) : busy ? (
          '正在更新…'
        ) : (
          notice ||
          '点击画线；Enter 保留开放线条；点击首点闭合；Space 或鼠标中键平移。'
        )}
      </footer>
    </main>
  );
}
