export type ObjectTransformDelta = {
  x: number;
  y: number;
  matrix?: number[];
  angleRad?: number;
  factor?: number;
};
export const objectTransformAttribute = (delta: ObjectTransformDelta) =>
  delta.matrix
    ? `matrix(${delta.matrix.join(' ')})`
    : `translate(${delta.x} ${delta.y})`;
