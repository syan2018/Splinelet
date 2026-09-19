import { createAuthoringCommand } from '../editing/commands/authoring.mjs';
import { SOURCE_ACTIONS } from '../editing/commands/source.mjs';
import { ADVANCED_ACTIONS } from '../editing/commands/advanced.mjs';
import { RESOURCE_ACTIONS } from '../editing/commands/resources.mjs';
import { PATH_METADATA_ACTIONS } from '../editing/commands/path-metadata.mjs';
import { PATH_DELETION_ACTIONS } from '../editing/commands/path-deletion.mjs';
import { PATH_GEOMETRY_ACTIONS } from '../editing/commands/path-geometry.mjs';
import { exportSnapshot } from '../export/snapshot.mjs';

export const V4_AGENT_API_VERSION = '5.0';

const AUTHORING_ACTIONS = Object.freeze([
  ...SOURCE_ACTIONS,
  ...Object.values(ADVANCED_ACTIONS),
  ...RESOURCE_ACTIONS,
  ...PATH_METADATA_ACTIONS,
  ...PATH_DELETION_ACTIONS,
  ...PATH_GEOMETRY_ACTIONS,
  'set-node',
  'transfer-source',
  'set-print-settings',
  'set-relief',
  'clear-region-paint',
  'partition-regions',
  'cut-hole',
  'draw-partition',
  'draw-hole',
  'close-path',
  'create-shape',
  'draw-path',
  'start-path',
  'extend-path',
  'group-nodes',
  'move-nodes',
  'paint-region',
  'set-handle',
  'set-thickness',
  'set-vertex',
  'ungroup-nodes',
]);
const EVALUATION_DOMAINS = new Set([
  'curves',
  'regions',
  'relief',
  'placed-relief',
  'bodies',
]);
const DEFAULT_EXPORTS = Object.freeze([
  { format: 'stl', stage: 'bodies' },
  { format: '3mf', stage: 'bodies' },
  { format: '3mf-bambu', stage: 'bodies' },
  { format: 'blender-bodies', stage: 'bodies' },
]);
const LEGACY_INDEX_KEYS = /^(node|cell|group|path|feature|region)Index(es)?$/i;
const clone = (value) => structuredClone(value);

export class V4AgentAPIError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'V4AgentAPIError';
    this.code = code;
    this.details = clone(details);
  }
}

const reject = (code, message, details) => {
  throw new V4AgentAPIError(code, message, details);
};
const assertObject = (value, label = 'args') => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    reject('invalid-arguments', `${label} 必须是对象`);
  return value;
};
const assertExpectedRevision = (args) => {
  if (!Number.isInteger(args?.expectedRevision))
    reject(
      'expected-revision-required',
      '写操作必须提供当前整数 expectedRevision',
    );
  return args.expectedRevision;
};
const assertNoLegacyIndexes = (value, path = 'action') => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoLegacyIndexes(item, `${path}[${index}]`),
    );
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_INDEX_KEYS.test(key))
      reject(
        'legacy-index-write',
        'API 5.0 写操作不接受旧数组索引；请使用稳定 EntityRef/ID',
        { path: `${path}.${key}` },
      );
    assertNoLegacyIndexes(child, `${path}.${key}`);
  }
};
const canonicalDomains = (value) => {
  if (!Array.isArray(value) || !value.length)
    reject('invalid-domains', 'domains 必须是非空数组');
  const result = [...new Set(value)];
  if (result.some((domain) => !EVALUATION_DOMAINS.has(domain)))
    reject('invalid-domains', 'domains 包含未知阶段');
  return result.sort((left, right) => left.localeCompare(right));
};
const assertIdentity = (state, args, { committed = false } = {}) => {
  if (typeof args?.epoch !== 'string' || !args.epoch)
    reject('epoch-required', '必须提供目标 epoch');
  if (!Number.isInteger(args.revision) || args.revision < 0)
    reject('revision-required', '必须提供目标非负整数 revision');
  if (args.epoch !== state.epoch || args.revision !== state.revision)
    reject('stale-snapshot', '请求的 epoch/revision 已过期', {
      requested: { epoch: args.epoch, revision: args.revision },
      current: { epoch: state.epoch, revision: state.revision },
    });
  if (committed && state.previewId !== null)
    reject(
      'preview-not-exportable',
      '导出只能使用当前已提交 revision；请先提交或取消 preview',
      { previewId: state.previewId },
    );
};
const publicEditorState = (state) => ({
  epoch: state.epoch,
  revision: state.revision,
  previewId: state.previewId,
  preview: state.preview ? clone(state.preview) : null,
  canUndo: state.canUndo,
  canRedo: state.canRedo,
  lastChange: state.lastChange ? clone(state.lastChange) : null,
  document: clone(state.document),
});
const resultForIdentity = (state, identity, domains) =>
  Object.values(state.results || {}).find(
    (item) =>
      item.epoch === identity.epoch &&
      item.revision === identity.revision &&
      item.previewId === identity.previewId &&
      item.domains?.join('\u0000') === domains.join('\u0000'),
  );

function legacyProjection(state) {
  const document = state.document;
  const nodeRef = (id) => ({ kind: 'node', id });
  return {
    protocol: '4.1-read-projection',
    sourceDocumentVersion: document.version,
    epoch: state.epoch,
    revision: state.revision,
    units: document.units,
    nodes: Object.values(document.nodes).map((node) => ({
      ref: nodeRef(node.id),
      id: node.id,
      name: node.name,
      kind: node.kind,
      parentRef: node.parentId === null ? null : nodeRef(node.parentId),
      order: node.order,
      pose: clone(node.pose),
      visible: node.visible,
      locked: node.locked,
      ...(node.kind === 'shape'
        ? { programRef: { kind: 'program', id: node.programId } }
        : {}),
    })),
    paths: Object.values(document.sketches).flatMap((sketch) =>
      Object.values(sketch.paths).map((path) => ({
        ref: { kind: 'path', sketchId: sketch.id, id: path.id },
        ownerRef: nodeRef(sketch.ownerNodeId),
        name: path.name,
        visible: path.visible,
        edgeRefs: path.edges.map((use) => ({
          ref: {
            kind: 'edge',
            sketchId: sketch.id,
            id: use.edgeId,
          },
          reversed: use.reversed,
        })),
      })),
    ),
    outputs: Object.values(document.programs).flatMap((program) =>
      Object.entries(program.outputs).map(([name, ref]) => ({
        name,
        ownerRef: nodeRef(program.ownerNodeId),
        ref: clone(ref),
      })),
    ),
    compatibility: {
      stableRefsOnly: true,
      writeSupported: false,
      migration: '旧数组索引和旧 group 写语义必须迁移到 API 5.0 authoring.run',
    },
  };
}

/**
 * Agent API 5.0. Every mutation delegates to the same editor dispatcher used
 * by the GUI; evaluation and export consume explicit snapshot identities.
 */
export function createV4AgentAPI(options = {}) {
  const editor = options.editorSession;
  if (!editor?.state || typeof editor.dispatch !== 'function')
    reject('invalid-editor-session', 'editorSession 必须提供 state/dispatch');
  const evaluation = options.evaluationSession || null;
  if (
    options.evaluationCapabilities !== undefined &&
    !Array.isArray(options.evaluationCapabilities)
  )
    reject('invalid-capabilities', 'evaluationCapabilities 必须是数组');
  const evaluationCapabilities = [
    ...new Set(options.evaluationCapabilities || []),
  ].sort((left, right) => left.localeCompare(right));
  if (evaluationCapabilities.some((domain) => !EVALUATION_DOMAINS.has(domain)))
    reject('invalid-capabilities', 'evaluationCapabilities 包含未知阶段');
  const advertisedEvaluation = evaluation ? evaluationCapabilities : [];
  const exporter = options.exporter || exportSnapshot;
  const exportCapabilities = evaluation
    ? (options.exportFormats || DEFAULT_EXPORTS)
        .filter(
          (entry) =>
            entry &&
            typeof entry.format === 'string' &&
            advertisedEvaluation.includes(entry.stage),
        )
        .map((entry) => ({ format: entry.format, stage: entry.stage }))
    : [];
  const actionNames = [
    'capabilities.get',
    'document.get',
    'legacy.read',
    'authoring.run',
    'preview.begin',
    'preview.update',
    'preview.commit',
    'preview.cancel',
    'undo',
    'redo',
    ...(typeof options.getSelection === 'function' ? ['selection.get'] : []),
    ...(evaluation ? ['evaluation.request'] : []),
    ...(exportCapabilities.length ? ['export.run'] : []),
  ];
  const capabilities = Object.freeze({
    apiVersion: V4_AGENT_API_VERSION,
    documentVersion: 4,
    units: 'mm',
    actions: actionNames,
    authoringActions: [...AUTHORING_ACTIONS],
    evaluationDomains: advertisedEvaluation,
    exports: exportCapabilities,
    selectionRead: typeof options.getSelection === 'function',
    previewWrites: true,
    preparedWrites: false,
    legacy: {
      readProjection: true,
      stableRefsOnly: true,
      write: false,
    },
  });

  const call = async (action, args = {}) => {
    if (typeof action !== 'string' || !action)
      reject('invalid-action', 'action 必须是非空字符串');
    if (action.startsWith('legacy.') && action !== 'legacy.read')
      reject(
        'legacy-write-requires-migration',
        '旧写协议不再接受数组索引或旧 group 语义；请改用 API 5.0 authoring.run 与稳定引用',
        { action },
      );
    if (action === 'capabilities.get') return clone(capabilities);
    if (action === 'document.get')
      return {
        apiVersion: V4_AGENT_API_VERSION,
        documentVersion: editor.state.document.version,
        units: editor.state.document.units,
        ...publicEditorState(editor.state),
      };
    if (action === 'selection.get') {
      if (typeof options.getSelection !== 'function')
        reject('capability-unavailable', 'selection.get 未注入');
      return {
        epoch: editor.state.epoch,
        revision: editor.state.revision,
        selection: clone(options.getSelection()),
      };
    }
    if (action === 'legacy.read') {
      assertObject(args);
      assertIdentity(editor.state, args);
      return legacyProjection(editor.state);
    }
    if (action === 'preview.begin') {
      assertObject(args);
      return publicEditorState(
        editor.beginPreview({ expectedRevision: assertExpectedRevision(args) }),
      );
    }
    if (action === 'preview.commit' || action === 'preview.cancel') {
      assertObject(args);
      const method =
        action === 'preview.commit' ? 'commitPreview' : 'cancelPreview';
      return publicEditorState(
        editor[method]({
          expectedRevision: assertExpectedRevision(args),
          previewId: args.previewId,
        }),
      );
    }
    if (action === 'authoring.run' || action === 'preview.update') {
      assertObject(args);
      const expectedRevision = assertExpectedRevision(args);
      const request = assertObject(args.action, 'action');
      if (!AUTHORING_ACTIONS.includes(request.kind))
        reject(
          'unsupported-authoring-action',
          `未实现的 authoring action：${request.kind}`,
        );
      assertNoLegacyIndexes(request);
      if (action === 'preview.update')
        return publicEditorState(
          editor.updatePreview(createAuthoringCommand(request), {
            expectedRevision,
            previewId: args.previewId,
          }),
        );
      return publicEditorState(
        editor.dispatch(createAuthoringCommand(request), { expectedRevision }),
      );
    }
    if (action === 'undo' || action === 'redo') {
      assertObject(args);
      const expectedRevision = assertExpectedRevision(args);
      return publicEditorState(editor[action]({ expectedRevision }));
    }
    if (action === 'evaluation.request') {
      if (!evaluation)
        reject('capability-unavailable', 'evaluation.request 未注入');
      assertObject(args);
      assertIdentity(editor.state, args);
      const domains = canonicalDomains(args.domains);
      const unavailable = domains.filter(
        (domain) => !advertisedEvaluation.includes(domain),
      );
      if (unavailable.length)
        reject('capability-unavailable', '请求的求值阶段不可用', {
          unavailableDomains: unavailable,
        });
      evaluation.update(editor.state);
      await evaluation.request({ domains });
      assertIdentity(editor.state, args);
      const identity = {
        epoch: editor.state.epoch,
        revision: editor.state.revision,
        previewId: editor.state.previewId,
      };
      const result = resultForIdentity(evaluation.state, identity, domains);
      if (!result)
        reject('evaluation-result-missing', '求值完成但当前身份没有结果');
      return { ...identity, domains, result: clone(result) };
    }
    if (action === 'export.run') {
      if (!evaluation || !exportCapabilities.length)
        reject('capability-unavailable', 'export.run 未注入');
      assertObject(args);
      const state = editor.state;
      assertIdentity(state, args, { committed: true });
      const capability = exportCapabilities.find(
        (entry) => entry.format === args.format && entry.stage === args.stage,
      );
      if (!capability)
        reject('capability-unavailable', '请求的 format/stage 导出不可用', {
          format: args.format,
          stage: args.stage,
        });
      const domains = [capability.stage];
      evaluation.update(state);
      const pending = evaluation.request({ domains });
      const captured = evaluation.awaitCommittedSnapshot({
        epoch: args.epoch,
        revision: args.revision,
        domains,
      });
      const [, snapshot] = await Promise.all([pending, captured]);
      const artifact = await exporter(snapshot, {
        ...clone(args.options || {}),
        format: capability.format,
        stage: capability.stage,
      });
      return {
        epoch: args.epoch,
        revision: args.revision,
        format: capability.format,
        stage: capability.stage,
        artifact: clone(artifact),
      };
    }
    reject('unsupported-action', `API 5.0 不支持 action：${action}`);
  };

  return Object.freeze({
    version: V4_AGENT_API_VERSION,
    get capabilities() {
      return clone(capabilities);
    },
    call,
  });
}
