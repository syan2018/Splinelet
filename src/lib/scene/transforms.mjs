const finite = (value, label) => {
  if (!Number.isFinite(value)) throw Error(`${label} 必须是有限数`);
  return value;
};

export const identityTransform = () => [1, 0, 0, 1, 0, 0];

export function assertTransform(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 6)
    throw Error('二维变换需要六个系数');
  matrix.forEach((value) => finite(value, '变换系数'));
  return matrix;
}

export function assertPoint(point) {
  if (!Array.isArray(point) || point.length !== 2)
    throw Error('二维位置需要两个坐标');
  point.forEach((value) => finite(value, '坐标'));
  return point;
}

export function multiplyTransforms(left, right) {
  const [a, b, c, d, e, f] = assertTransform(left);
  const [g, h, i, j, k, l] = assertTransform(right);
  return assertTransform([
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ]);
}

export function inverseTransform(matrix) {
  const [a, b, c, d, e, f] = assertTransform(matrix);
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0)
    throw Error('变换不可逆');
  return assertTransform([
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ]);
}

export function transformPoint(matrix, point) {
  const [a, b, c, d, e, f] = assertTransform(matrix);
  const [x, y] = assertPoint(point);
  return assertPoint([a * x + c * y + e, b * x + d * y + f]);
}

export function transformVector(matrix, vector) {
  const [a, b, c, d] = assertTransform(matrix);
  const [x, y] = assertPoint(vector);
  return assertPoint([a * x + c * y, b * x + d * y]);
}

export function poseMatrix(pose) {
  const [x, y] = assertPoint(pose?.translationMM);
  const angle = finite(pose.rotationRad, '旋转角');
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine, sine, -sine, cosine, x, y];
}

export function matrixPose(matrix, tolerance = 1e-9) {
  const [a, b, c, d, e, f] = assertTransform(matrix);
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw Error('刚性变换容差必须为正有限数');
  if (
    Math.abs(a * a + b * b - 1) > tolerance ||
    Math.abs(c * c + d * d - 1) > tolerance ||
    Math.abs(a * c + b * d) > tolerance ||
    Math.abs(a * d - b * c - 1) > tolerance
  )
    throw Error('场景 pose 只允许平移和旋转；缩放或镜像请使用几何算子');
  return { translationMM: [e, f], rotationRad: Math.atan2(b, a) };
}

export function worldMatrix(document, nodeId, cache = new Map()) {
  // The cache belongs to one immutable document evaluation, never a later revision.
  const visiting = new Set();
  const chain = [];
  let id = nodeId;
  while (id !== null && !cache.has(id)) {
    if (typeof id !== 'string' || !Object.hasOwn(document.nodes, id))
      throw Error(`场景节点不存在：${id}`);
    const node = document.nodes[id];
    if (!node) throw Error(`场景节点不存在：${id}`);
    if (visiting.has(id)) throw Error(`场景父链存在循环：${id}`);
    visiting.add(id);
    if (
      node.parentId !== null &&
      document.nodes[node.parentId]?.kind !== 'group'
    )
      throw Error(`场景父级必须是存在的组：${node.parentId}`);
    chain.push(node);
    id = node.parentId;
  }
  let matrix = id === null ? identityTransform() : cache.get(id).slice();
  for (let index = chain.length - 1; index >= 0; index--) {
    const node = chain[index];
    matrix = multiplyTransforms(matrix, poseMatrix(node.pose));
    cache.set(node.id, matrix);
  }
  return matrix.slice();
}

export function inputFrameTransform(document, receiverId, input) {
  const placement = assertTransform(input.transform);
  if (input.space === 'local-result') return placement.slice();
  if (input.space !== 'world-result') throw Error('构造输入空间无效');
  const cache = new Map();
  return multiplyTransforms(
    placement,
    multiplyTransforms(
      inverseTransform(worldMatrix(document, receiverId, cache)),
      worldMatrix(document, input.ownerNodeId, cache),
    ),
  );
}

export function relationFrameTransform(
  document,
  targetOwnerId,
  sourceOwnerId,
  frame,
) {
  matrixPose(frame.transform);
  if (frame.space === 'owner-local') return frame.transform.slice();
  if (frame.space !== 'world') throw Error('关系引用空间无效');
  return multiplyTransforms(
    frame.transform,
    multiplyTransforms(
      inverseTransform(worldMatrix(document, targetOwnerId)),
      worldMatrix(document, sourceOwnerId),
    ),
  );
}
