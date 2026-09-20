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
  let delta = { x: 0, y: 0 };
  return {
    update(next: { x: number; y: number }) {
      delta = next;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        elements.forEach((element, index) => {
          element.setAttribute(
            'transform',
            `translate(${delta.x} ${delta.y}) ${originals[index] || ''}`,
          );
        });
      });
    },
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
