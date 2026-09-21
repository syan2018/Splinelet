import * as THREE from 'three';
import type { CurvePreview } from '@/lib/modifier-types';

export function curvePreviewGroup(
  previews: CurvePreview[],
  height: (objectId: string) => number,
) {
  const group = new THREE.Group();
  for (const preview of previews) {
    const z = height(preview.objectId),
      points: number[] = [];
    for (const cubic of preview.curves) {
      const [a, b, c, d] = cubic.map((p) => new THREE.Vector3(p.x, p.y, z));
      const sampled = new THREE.CubicBezierCurve3(a, b, c, d).getPoints(32);
      for (let i = 1; i < sampled.length; i++)
        points.push(...sampled[i - 1].toArray(), ...sampled[i].toArray());
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(points, 3),
    );
    const line = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: '#65d9ff',
        depthTest: false,
        depthWrite: false,
      }),
    );
    line.renderOrder = 10000;
    line.raycast = () => {};
    group.add(line);
    if (preview.junctions.length) {
      const marks = new THREE.BufferGeometry().setFromPoints(
        preview.junctions.map(
          ({ point }) => new THREE.Vector3(point.x, point.y, z),
        ),
      );
      const nodes = new THREE.Points(
        marks,
        new THREE.PointsMaterial({
          color: '#ffac62',
          size: 8,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
        }),
      );
      nodes.renderOrder = 10001;
      nodes.raycast = () => {};
      group.add(nodes);
    }
  }
  return group;
}

export function disposeCurvePreview(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.LineSegments || child instanceof THREE.Points) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((m) => m.dispose());
    }
  });
  group.removeFromParent();
}
