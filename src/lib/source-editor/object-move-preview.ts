import {
  objectTransformAttribute,
  type ObjectTransformDelta,
} from './object-transform-preview';
/** Temporary SVG transforms only; the document remains owned by the runtime. */
export function objectMovePreview(
  stage: Element,
  nodeIds: string[],
  pathIds: string[],
) {
  const nodes = new Set(nodeIds);
  const paths = new Set(pathIds);
  const elements = Array.from(
    stage.querySelectorAll<SVGElement>(
      '[data-object-id], [data-source-id], [data-curve-preview-object]',
    ),
  ).filter(
    (element) =>
      nodes.has(element.getAttribute('data-object-id') || '') ||
      nodes.has(element.getAttribute('data-curve-preview-object') || '') ||
      paths.has(element.getAttribute('data-source-id') || ''),
  );
  const originals = elements.map((element) =>
    element.getAttribute('transform'),
  );
  let frame = 0;
  let delta: ObjectTransformDelta = { x: 0, y: 0 };
  const flush = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    elements.forEach((element, index) => {
      element.setAttribute(
        'transform',
        `${objectTransformAttribute(delta)} ${originals[index] || ''}`,
      );
    });
  };
  return {
    update(next: ObjectTransformDelta) {
      delta = next;
      if (frame) return;
      frame = requestAnimationFrame(flush);
    },
    flush,
    clear() {
      cancelAnimationFrame(frame);
      frame = 0;
      elements.forEach((element, index) => {
        const original = originals[index];
        if (original === null) element.removeAttribute('transform');
        else element.setAttribute('transform', original);
      });
    },
  };
}
