import { encodeDocument } from '../document/codec.mjs';
import { sameDocument } from '../editing/history.mjs';

const clone = (value) => structuredClone(value);
const freeze = (value) => {
  if (value && typeof value === 'object') {
    if (ArrayBuffer.isView(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};
const readonly = (value) => freeze(clone(value));
const DRAFT_KEY = 'v4-session';

/** File/draft coordinator. Platform reads and writes are injected by I00. */
export function createV4PersistenceSession(options = {}) {
  const encode = options.encodeV4 || encodeDocument;
  const writer = options.writeFile;
  const drafts = options.drafts || {};
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  if (typeof encode !== 'function' || typeof writer !== 'function')
    throw Error('需要 encodeV4 和 writeFile 注入');
  let epoch = null;
  let revision = 0;
  let document = null;
  let assets = {};
  let target = null;
  let legacySource = false;
  let dirty = false;
  let queue = Promise.resolve();
  const state = () =>
    readonly({
      epoch,
      revision,
      document,
      assets,
      target,
      legacySource,
      dirty,
    });
  const requireCurrent = () => {
    if (!document || !epoch) throw Error('尚未打开 V4 文档');
  };
  const capture = ({
    expectedEpoch,
    expectedRevision,
    previewId = null,
  } = {}) => {
    requireCurrent();
    if (previewId !== null) throw Error('preview 不能保存或自动恢复');
    if (expectedEpoch !== epoch || expectedRevision !== revision)
      throw Error('保存 snapshot 已过期');
    return {
      epoch,
      revision,
      document: clone(document),
      assets: clone(assets),
      target,
    };
  };
  const enqueue = (task) => {
    const result = queue.catch(() => {}).then(task);
    queue = result;
    return result;
  };
  return Object.freeze({
    get state() {
      return state();
    },
    open(project) {
      if (project?.kind !== 'v4' && project?.kind !== 'legacy')
        throw Error('打开结果必须标明 V4 或旧工程');
      if (!project.document || typeof project.document !== 'object')
        throw Error('打开结果缺少 V4 Document');
      if (
        project.epoch !== undefined &&
        (typeof project.epoch !== 'string' || !project.epoch)
      )
        throw Error('打开结果 epoch 必须是非空字符串');
      const nextRevision =
        project.revision === undefined ? 0 : project.revision;
      if (!Number.isSafeInteger(nextRevision) || nextRevision < 0)
        throw Error('打开结果 revision 必须是非负安全整数');
      if (project.dirty !== undefined && typeof project.dirty !== 'boolean')
        throw Error('打开结果 dirty 必须是布尔值');

      // Clone every incoming mutable value before changing the active file.
      const nextEpoch = project.epoch || `file-${idFactory()}`;
      const nextDocument = clone(project.document);
      const nextAssets = clone(project.assets || {});
      const nextTarget = clone(project.target ?? null);
      const nextLegacySource = project.kind === 'legacy';
      const nextDirty = nextLegacySource || project.dirty === true;

      epoch = nextEpoch;
      revision = nextRevision;
      document = nextDocument;
      assets = nextAssets;
      target = nextLegacySource ? null : nextTarget;
      legacySource = nextLegacySource;
      dirty = nextDirty;
      return state();
    },
    update(editorState) {
      requireCurrent();
      if (editorState.previewId !== null) return state();
      if (
        editorState.epoch !== epoch ||
        !Number.isSafeInteger(editorState.revision) ||
        editorState.revision < 0
      )
        throw Error('编辑会话 epoch 不匹配');
      if (!editorState.document || typeof editorState.document !== 'object')
        throw Error('编辑会话缺少 V4 Document');
      if (editorState.revision < revision)
        throw Error('编辑会话 revision 已过期');
      if (editorState.revision === revision) {
        if (!sameDocument(document, editorState.document))
          throw Error('编辑会话 identity 不匹配');
        return state();
      }
      const nextDocument = clone(editorState.document);
      document = nextDocument;
      revision = editorState.revision;
      dirty = true;
      return state();
    },
    /** @param {{expectedEpoch:string, expectedRevision:number, previewId?:string|null}} options */
    async autosave({ expectedEpoch, expectedRevision, previewId = null } = {}) {
      const saved = capture({ expectedEpoch, expectedRevision, previewId });
      if (typeof drafts.write !== 'function') throw Error('未注入 V4 草稿存储');
      await enqueue(async () => {
        if (epoch !== saved.epoch) return;
        await drafts.write(DRAFT_KEY, {
          document: saved.document,
          assets: saved.assets,
        });
      });
      return state();
    },
    async restore({ expectedEpoch } = {}) {
      if (typeof drafts.read !== 'function') throw Error('未注入 V4 草稿存储');
      const startEpoch = expectedEpoch;
      const recovered = await drafts.read(DRAFT_KEY);
      if (!recovered) return null;
      if (epoch !== startEpoch) throw Error('恢复结果已过期');
      return readonly(recovered);
    },
    /** A detached file copy never binds a target or marks the document saved. */
    exportBytes(options) {
      const saved = capture(options);
      return encode(saved.document, { assets: saved.assets });
    },
    /** @param {{expectedEpoch:string, expectedRevision:number, previewId?:string|null, saveAsTarget?:unknown}} options */
    save({
      expectedEpoch,
      expectedRevision,
      previewId = null,
      saveAsTarget,
    } = {}) {
      const saved = capture({ expectedEpoch, expectedRevision, previewId });
      const destination = saveAsTarget || saved.target;
      if (!destination) throw Error('旧工程首次保存必须选择新的 V4 文件');
      const bytes = encode(saved.document, { assets: saved.assets });
      return enqueue(async () => {
        await writer(destination, bytes);
        if (epoch === saved.epoch && revision === saved.revision) {
          target = destination;
          legacySource = false;
          dirty = false;
        }
        return state();
      });
    },
  });
}

export { DRAFT_KEY };
