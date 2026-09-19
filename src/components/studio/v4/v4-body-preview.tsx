'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
type MeshData = { positions: number[]; triangles: number[] };
export type BodyPreview = {
  status: string;
  diagnostics: { message: string }[];
  value?: {
    bodies: {
      mesh: MeshData;
      materialParts: { mesh: MeshData; color: string }[];
    }[];
  };
};
export function V4BodyPreview({ stage }: { stage: BodyPreview }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = container.current;
    if (!host || stage.status !== 'ready' || !stage.value) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      group = new THREE.Group();
    scene.add(group);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x596070, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(50, -80, 150);
    scene.add(light);
    const disposables: { dispose(): void }[] = [];
    for (const body of stage.value.bodies)
      for (const part of body.materialParts.length
        ? body.materialParts
        : [{ mesh: body.mesh, color: '#cccccc' }]) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(part.mesh.positions, 3),
        );
        geometry.setIndex(part.mesh.triangles);
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          color: part.color,
          roughness: 0.65,
          metalness: 0.05,
        });
        group.add(new THREE.Mesh(geometry, material));
        disposables.push(geometry, material);
      }
    const bounds = new THREE.Box3().setFromObject(group),
      center = bounds.getCenter(new THREE.Vector3()),
      size = bounds.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 1);
    const camera = new THREE.PerspectiveCamera(
      40,
      1,
      extent / 1000,
      extent * 100,
    );
    camera.up.set(0, 0, 1);
    camera.position
      .copy(center)
      .add(new THREE.Vector3(extent, -extent, extent * 1.5));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.update();
    const draw = () => renderer.render(scene, camera);
    controls.addEventListener('change', draw);
    const resize = new ResizeObserver(() => {
      const width = host.clientWidth,
        height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      draw();
    });
    resize.observe(host);
    return () => {
      resize.disconnect();
      controls.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [stage]);
  return (
    <div
      aria-label="成品预览"
      style={{
        height: '100%',
        minHeight: 0,
        position: 'relative',
        background: '#202736',
      }}
      ref={container}
    >
      {stage.status !== 'ready' && (
        <p>
          {stage.status === 'empty'
            ? '还没有启用的区域，请先上色。'
            : stage.diagnostics.map((item) => item.message).join('；')}
        </p>
      )}
    </div>
  );
}
