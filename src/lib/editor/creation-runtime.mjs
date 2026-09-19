import { createCreationIntent } from './creation-intents.mjs';
import { projectCreationView } from './creation-view.mjs';
import { evaluateDocument } from '../evaluation/evaluate-document.mjs';
import { createAuthoringCommand } from '../editing/commands/authoring.mjs';
import { sameDocument } from '../editing/history.mjs';
import { evaluatePlanar } from '../construction/document-evaluation.mjs';
import { projectCurvePreviews } from './curve-preview.mjs';
import { createSourceRuntime } from './source-runtime.mjs';
import { projectSourceView } from './source-view.mjs';
import { projectEndpointSnapContext } from './endpoint-snap-view.mjs';
import { beginRuntimeGesture } from './runtime-gesture.mjs';
import { effectiveNodeState } from '../scene/hierarchy.mjs';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const sameIdentity = (a, b) =>
  a.epoch === b.epoch &&
  a.revision === b.revision &&
  (a.previewId ?? null) === (b.previewId ?? null);
const identity = (state) => ({
  epoch: state.epoch,
  revision: state.revision,
  previewId: state.previewId ?? null,
});
const documentOf = (state) =>
  state.previewId ? state.preview.document : state.document;
const sameState = (a, b) =>
  sameIdentity(a, b) &&
  (!a.previewId ||
    (a.preview.version === b.preview.version &&
      sameDocument(documentOf(a), documentOf(b))));

/**
 * Backend for the established CreationWorkspace. Display projects are opaque
 * readonly handles: only those issued here can be evaluated or committed.
 * toDisplayProject is a presentation projector, never a document decoder.
 */
export function createV4CreationRuntime({
  editorSession,
  toDisplayProject,
  evaluate = evaluateDocument,
  intent = createCreationIntent,
  sourceFrame,
}) {
  if (!editorSession?.dispatch || typeof toDisplayProject !== 'function')
    throw Error('创作运行时需要编辑会话和只读展示投影');
  const projects = new WeakMap();
  const snapFrame = structuredClone(sourceFrame);
  let snapCache = null;
  const scenes = new WeakMap();
  const prepared = new WeakMap();
  let currentDisplay = null;
  let disposed = false;
  const assertAlive = () => {
    if (disposed) throw Error('创作运行时已关闭');
  };
  const issue = (state, creation = null, token = null) => {
    assertAlive();
    if (
      !token &&
      currentDisplay &&
      sameState(projects.get(currentDisplay).state, state)
    )
      return currentDisplay;
    const view = creation || projectCreationView(documentOf(state), {});
    const project = freeze(structuredClone(toDisplayProject(state, view)));
    if (!project || typeof project !== 'object')
      throw Error('展示投影必须返回对象');
    projects.set(project, { state, view, token });
    if (!token) currentDisplay = project;
    return project;
  };
  const metadata = (project) => {
    assertAlive();
    const entry = projects.get(project);
    if (!entry) throw Error('不接受外部或可写的展示工程');
    return entry;
  };
  const current = (project) => {
    const entry = metadata(project);
    if (entry.token || !sameState(entry.state, editorSession.state))
      throw Error('展示工程已过期或尚未提交');
    if (entry.state.previewId) throw Error('请先完成当前拖动');
    return entry;
  };
  const displayed = (context) => {
    const entry = current(context.project);
    if (context.scene) {
      const scene = scenes.get(context.scene);
      if (!scene || scene.project !== context.project)
        throw Error('区域结果不属于当前展示工程');
    }
    return { ...identity(entry.state), ...(context.scene || entry.view) };
  };
  const commitToken = (handle, context) => {
    current(context.project);
    const item = prepared.get(handle);
    if (!item || item.baseProject !== context.project)
      throw Error('预备命令已失效或不属于当前工程');
    const state = editorSession.dispatch(item.token, {
      expectedRevision: item.token.revision,
    });
    prepared.delete(handle);
    return issue(state);
  };
  const sourceRuntime = createSourceRuntime({
    editorSession,
    sourceFrame,
    getEntry: metadata,
    issueProject: issue,
    sameState,
  });
  return Object.freeze({
    ...sourceRuntime,
    project() {
      return issue(editorSession.state);
    },
    readCreationDocument(project) {
      return metadata(project).view.creation;
    },
    beginObjectGesture(project, nodeIds) {
      const entry = current(project);
      if (!Array.isArray(nodeIds) || !nodeIds.length)
        throw Error('移动部件需要非空选区');
      const ids = [...new Set(nodeIds)];
      for (const id of ids) {
        if (
          typeof id !== 'string' ||
          !Object.hasOwn(entry.state.document.nodes, id)
        )
          throw Error('移动部件不存在');
        const state = effectiveNodeState(entry.state.document, id);
        if (!state.visible || state.locked) throw Error('移动部件已隐藏或锁定');
      }
      const frame = sourceRuntime.readSourceView(project).source.frame;
      const [a, b, c, d] = frame.pixelToWorld;
      return beginRuntimeGesture({
        editorSession,
        project,
        getEntry: metadata,
        issueProject: issue,
        captured: entry.state,
        compile(delta) {
          if (!Number.isFinite(delta?.x) || !Number.isFinite(delta?.y))
            throw Error('拖动位移必须是有限像素坐标');
          return createAuthoringCommand({
            kind: 'move-nodes',
            nodeIds: ids,
            deltaMM: [a * delta.x + c * delta.y, b * delta.x + d * delta.y],
          });
        },
      });
    },
    readEndpointSnapContext(project, pathId, nodeIndex) {
      const entry = metadata(project);
      if (entry.token || !sameState(entry.state, editorSession.state))
        throw Error('吸附展示工程已过期或尚未提交');
      if (
        snapCache?.epoch !== entry.state.epoch ||
        snapCache?.revision !== entry.state.revision
      )
        snapCache = {
          epoch: entry.state.epoch,
          revision: entry.state.revision,
          values: new Map(),
        };
      const key = JSON.stringify([pathId, nodeIndex]);
      if (snapCache.values.has(key)) return snapCache.values.get(key);
      // Guides remain anchored to the committed source throughout a preview;
      // moving copies must never become their own evolving snap targets.
      const context = projectEndpointSnapContext(
        entry.state.document,
        entry.state.previewId
          ? projectSourceView(entry.state.document, snapFrame)
          : sourceRuntime.readSourceView(project).source,
        pathId,
        nodeIndex,
      );
      snapCache.values.set(key, context);
      return context;
    },
    readCurvePreviews(project) {
      const entry = metadata(project);
      if (!sameState(entry.state, editorSession.state))
        throw Error('样条预览工程已过期');
      if (!entry.curvePreviews) {
        const document = documentOf(entry.state);
        entry.curvePreviews = projectCurvePreviews(
          document,
          evaluatePlanar(document, { requestedDomains: ['curves'] }),
        );
      }
      return entry.curvePreviews;
    },
    async evaluate(action, args, project) {
      const entry = metadata(project);
      if (action !== 'creation') throw Error(`V4 创作求值尚未适配：${action}`);
      if (Object.keys(args || {}).length)
        throw Error('预览参数须先通过明确的预备命令编译');
      const snapshot = await evaluate(documentOf(entry.state), {
        requestedDomains: ['curves', 'regions', 'relief', 'placed-relief'],
      });
      assertAlive();
      if (!sameState(entry.state, editorSession.state))
        throw Error('求值期间工程已变化');
      const view = projectCreationView(documentOf(entry.state), snapshot);
      scenes.set(view, { project, snapshot });
      entry.view = view;
      return view;
    },
    bindEvaluation(project, scene) {
      const entry = metadata(project);
      const evaluated = scenes.get(scene);
      if (
        !evaluated ||
        evaluated.project !== project ||
        !sameState(entry.state, editorSession.state)
      )
        throw Error('求值结果不能绑定到其他工程');
      return { project, scene };
    },
    command(action, args, context) {
      const command = intent(action, args, displayed(context));
      const state = metadata(context.project).state;
      let consumed = false;
      return {
        project: context.project,
        commit() {
          if (consumed) throw Error('命令已提交');
          current(context.project);
          const next = editorSession.dispatch(command, {
            expectedRevision: state.revision,
          });
          consumed = true;
          return issue(next);
        },
      };
    },
    async prepare(action, args, context) {
      const command = intent(action, args, displayed(context));
      const base = metadata(context.project).state;
      const token = await editorSession.prepare(command, {
        expectedRevision: base.revision,
      });
      current(context.project);
      const prospective = { ...base, document: token.result.document };
      const handle = Object.freeze({
        project: issue(prospective, null, token),
        token,
      });
      prepared.set(handle, { token, baseProject: context.project });
      return handle;
    },
    commitPrepared: commitToken,
    commitPreparedDisplay() {
      throw Error('此展示工程不含已准备的底板命令');
    },
    setSlicerTemplate(template, context) {
      const entry = current(context.project);
      const next = editorSession.dispatch(
        createAuthoringCommand({ kind: 'set-slicer-template', template }),
        { expectedRevision: entry.state.revision },
      );
      return issue(next);
    },
    attachNewPath() {
      throw Error('V4 新线条必须通过源编辑命令建立稳定身份');
    },
    dispose() {
      disposed = true;
    },
  });
}
