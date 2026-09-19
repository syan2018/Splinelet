'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
type MeshData = { positions: number[]; triangles: number[] };
type ReliefResult = {
  mesh?: MeshData;
  report?: { bounds?: [[number, number, number], [number, number, number]] };
};
type SceneState = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  mesh: THREE.Mesh | null;
  grid: THREE.GridHelper;
  framed: boolean;
};
type ViewKind = 'iso' | 'top' | 'side';

const disposeRenderable = (object: THREE.Object3D) => {
  if (
    !(
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.Points
    )
  )
    return;
  object.geometry.dispose();
  const materials = Array.isArray(object.material)
    ? object.material
    : [object.material];
  materials.forEach((material) => material.dispose());
};

const frameScene = (
  state: SceneState | null,
  result: ReliefResult | null,
  kind: ViewKind,
) => {
  if (!state) return;
  const bounds = result?.report?.bounds || [
      [-50, -50, 0],
      [50, 50, 5],
    ],
    center = new THREE.Vector3(...bounds[0])
      .add(new THREE.Vector3(...bounds[1]))
      .multiplyScalar(0.5),
    span = Math.max(
      bounds[1][0] - bounds[0][0],
      bounds[1][1] - bounds[0][1],
      10,
    ),
    distance = span * 2.1;
  state.controls.target.copy(center);
  state.camera.position
    .copy(center)
    .add(
      kind === 'top'
        ? new THREE.Vector3(0, -0.001, distance)
        : kind === 'side'
          ? new THREE.Vector3(0, -distance, 0)
          : new THREE.Vector3(distance * 0.12, -distance * 0.6, distance),
    );
  state.controls.update();
};

export default function ReliefView({
  result,
}: {
  result: ReliefResult | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    sceneRef = useRef<SceneState | null>(null),
    [error, setError] = useState(''),
    [heightColor, setHeightColor] = useState(false);
  const frameView = useCallback(
    (kind: ViewKind) => frameScene(sceneRef.current, result, kind),
    [result],
  );
  useEffect(() => {
    if (!host.current) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      queueMicrotask(() =>
        setError('三维显示不可用，请启用浏览器硬件加速。构面和导出仍可使用。'),
      );
      return;
    }
    const el = host.current;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor('#171d23');
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      '浮雕三维视图，左键旋转，右键平移，滚轮缩放',
    );
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(30, -100, 170);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667080, 0.8));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(-70, 80, 160);
    scene.add(light);
    const fill = new THREE.DirectionalLight(0xbbd4ff, 0.45);
    fill.position.set(80, -80, 50);
    scene.add(fill);
    const grid = new THREE.GridHelper(200, 20, 0x65717a, 0x303c45);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.05;
    scene.add(grid);
    const state = {
      scene,
      camera,
      controls,
      renderer,
      mesh: null as THREE.Mesh | null,
      grid,
      framed: false,
    };
    sceneRef.current = state;
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let frame = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      scene.traverse(disposeRenderable);
      renderer.dispose();
      el.replaceChildren();
      sceneRef.current = null;
    };
  }, []);
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (s.mesh) {
      s.scene.remove(s.mesh);
      disposeRenderable(s.mesh);
      s.mesh = null;
    }
    if (!result?.mesh) return;
    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(result.mesh.positions, 3),
    );
    geometry.setIndex(result.mesh.triangles);
    const indexed = geometry;
    geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    if (heightColor) {
      const p = geometry.attributes.position,
        colors = [];
      const max = result.report?.bounds?.[1][2] || 1;
      for (let i = 0; i < p.count; i++) {
        const color = new THREE.Color().setHSL(
          0.58 - (0.45 * p.getZ(i)) / max,
          0.45,
          0.59,
        );
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(colors, 3),
      );
    }
    const material = new THREE.MeshStandardMaterial({
      color: heightColor ? 0xffffff : 0xa8b7c4,
      roughness: 0.65,
      metalness: 0.02,
      vertexColors: heightColor,
    });
    s.mesh = new THREE.Mesh(geometry, material);
    s.scene.add(s.mesh);
    if (!s.framed) {
      frameScene(s, result, 'iso');
      s.framed = true;
    }
  }, [result, heightColor]);
  return (
    <div className="relief-view">
      <div className="relief-view-toolbar">
        <button onClick={() => frameView('iso')}>立体</button>
        <button onClick={() => frameView('top')}>正视</button>
        <button onClick={() => frameView('side')}>侧视</button>
        <button
          aria-pressed={heightColor}
          onClick={() => setHeightColor(!heightColor)}
        >
          {heightColor ? '按高度着色' : '单色实体'}
        </button>
      </div>
      <div className="webgl-host" ref={host} />
      {error && <p className="model-empty">{error}</p>}
      {!result && !error && (
        <p className="model-empty">先选择面并添加体块，即可查看浮雕</p>
      )}
      <div className="model-view-hint">
        左键旋转 · 右键平移 · 滚轮缩放 · 网格间距 10 mm
      </div>
    </div>
  );
}
