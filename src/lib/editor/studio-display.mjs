const clone = (value) => structuredClone(value);

const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
};

const positive = (value) => Number.isFinite(value) && value > 0;
const text = (value) => typeof value === 'string' && value.length > 0;
const transform = (value) =>
  Array.isArray(value) && value.length === 6 && value.every(Number.isFinite);
const near = (left, right) => {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= 1e-9 * scale;
};

const validateWorkspace = (workspaceView) => {
  if (
    !workspaceView ||
    typeof workspaceView.epoch !== 'string' ||
    !workspaceView.epoch ||
    !Number.isInteger(workspaceView.revision) ||
    workspaceView.revision < 0 ||
    !workspaceView.source ||
    !Array.isArray(workspaceView.source.paths) ||
    !workspaceView.source.frame ||
    !workspaceView.creation ||
    !workspaceView.creation.creation
  )
    throw Error('studio display 需要完整的 V4 workspace view');
  if (
    typeof workspaceView.canUndo !== 'boolean' ||
    typeof workspaceView.canRedo !== 'boolean'
  )
    throw Error('studio display 缺少 V4 history 状态');
};

const validatePresentation = (presentation, sourceFrame) => {
  if (!presentation || !Object.hasOwn(presentation, 'reference'))
    throw Error('studio display 的 reference 必须显式提供；无底图时使用 null');
  const reference = presentation?.reference;
  const frame = presentation?.frame;
  const session = presentation?.session;
  if (
    reference !== null &&
    (!reference ||
      !text(reference.id) ||
      !text(reference.assetId) ||
      !text(reference.name) ||
      !text(reference.url) ||
      !Number.isInteger(reference.pixelWidth) ||
      reference.pixelWidth <= 0 ||
      !Number.isInteger(reference.pixelHeight) ||
      reference.pixelHeight <= 0 ||
      !transform(reference.pixelToWorld) ||
      typeof reference.visible !== 'boolean' ||
      typeof reference.locked !== 'boolean' ||
      !Number.isFinite(reference.opacity) ||
      reference.opacity < 0 ||
      reference.opacity > 1)
  )
    throw Error('studio display 需要显式且完整的 Reference 与 asset URL');
  if (
    !frame ||
    !positive(frame.width) ||
    !positive(frame.height) ||
    !positive(frame.widthMM)
  )
    throw Error('studio display 需要显式正有限 frame');
  if (
    reference !== null &&
    (frame.width !== reference.pixelWidth ||
      frame.height !== reference.pixelHeight)
  )
    throw Error('studio display frame 必须使用 Reference 的像素尺寸');
  if (
    !sourceFrame ||
    !near(frame.width, sourceFrame.width) ||
    !near(frame.height, sourceFrame.height) ||
    !near(frame.widthMM, sourceFrame.widthMM) ||
    !transform(sourceFrame.pixelToWorld)
  )
    throw Error('studio display frame 与 source projection 不一致');
  if (
    reference !== null &&
    !reference.pixelToWorld.every((value, index) =>
      near(value, sourceFrame.pixelToWorld[index]),
    )
  )
    throw Error('Reference 仿射无法由当前原 Studio frame 精确显示');
  if (
    !session ||
    !Number.isFinite(session.blenderExtrusionMM) ||
    session.blenderExtrusionMM < 0 ||
    session.blenderExtrusionMM > 1000 ||
    !(session.fileName === null || typeof session.fileName === 'string') ||
    typeof session.storageStatus !== 'string' ||
    typeof session.dirty !== 'boolean'
  )
    throw Error('studio display 需要显式的文件状态与 Blender 挤出厚度');
};

/**
 * Builds the read boundary consumed by the established Studio shell. `project`
 * is a display facade, not a legacy Project: it must never be validated,
 * persisted, put in history, or mutated and translated back into V4.
 */
export function projectStudioDisplay(workspaceView, presentation) {
  validateWorkspace(workspaceView);
  validatePresentation(presentation, workspaceView.source.frame);

  const source = clone(workspaceView.source);
  const creation = clone(workspaceView.creation);
  const reference = clone(presentation.reference);
  const frame = clone(presentation.frame);
  const session = clone(presentation.session);
  const identity = {
    epoch: workspaceView.epoch,
    revision: workspaceView.revision,
    previewId: workspaceView.previewId ?? null,
  };
  const project = {
    version: 4,
    image: reference?.url ?? '',
    imageName: reference?.name ?? '',
    width: frame.width,
    height: frame.height,
    widthMM: frame.widthMM,
    depthMM: session.blenderExtrusionMM,
    paths: source.paths,
    creation: creation.creation,
  };

  return freeze({
    kind: 'v4-studio-display',
    identity,
    project,
    frame,
    reference,
    session,
    source,
    creation,
    canUndo: workspaceView.canUndo,
    canRedo: workspaceView.canRedo,
  });
}
