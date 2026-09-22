import type { Reference } from '@/lib/document/types';

type ReferenceWithUrl = Reference & { url: string };

export type ReferenceLayerProps = {
  references: ReferenceWithUrl[];
  worldToPixel: number[];
  opacity: number;
};

function multiplyAffine(left: number[], right: number[]) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}

/** Draws the references below the editing affordances. */
export function ReferenceLayer({
  references,
  worldToPixel,
  opacity,
}: ReferenceLayerProps) {
  if (worldToPixel.length !== 6) return null;

  return (
    <g className="reference-images" pointerEvents="none">
      {references.map((reference) => {
        const matrix = multiplyAffine(worldToPixel, reference.pixelToWorld);
        return (
          <image
            key={reference.id}
            data-reference-id={reference.id}
            href={reference.url}
            width={reference.pixelWidth}
            height={reference.pixelHeight}
            opacity={reference.visible ? reference.opacity * opacity : 0}
            transform={`matrix(${matrix.join(' ')})`}
          />
        );
      })}
    </g>
  );
}
