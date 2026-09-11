'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export default function CreationView({
  scene,
  selected,
  onSelect,
  tool,
}: {
  scene: any;
  selected: string[];
  onSelect: (key: string, add: boolean) => void;
  tool: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef<any>(null),
    callback = useRef(onSelect),
    [error, setError] = useState('');
  callback.current = onSelect;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError('三维显示不可用，请启用硬件加速；仍可编辑平面和导出。');
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor('#151c21');
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.setAttribute('aria-label', '作品立体画布');
    el.appendChild(renderer.domElement);
    const world = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(20, -125, 180);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    world.add(new THREE.HemisphereLight(0xffffff, 0x667588, 2));
    const light = new THREE.DirectionalLight(0xfff4e0, 3);
    light.position.set(-50, 60, 160);
    world.add(light);
    const grid = new THREE.GridHelper(200, 20, 0x5b707b, 0x283840);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.05;
    world.add(grid);
    const content = new THREE.Group();
    world.add(content);
    const s = { renderer, world, camera, controls, content, framed: false };
    state.current = s;
    const resize = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) {
        renderer.setSize(r.width, r.height);
        const oldAspect = camera.aspect;
        camera.aspect = r.width / r.height;
        if (s.framed) {
          camera.position
            .sub(controls.target)
            .multiplyScalar(Math.min(1, oldAspect) / Math.min(1, camera.aspect))
            .add(controls.target);
        }
        camera.updateProjectionMatrix();
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let frame = 0;
    const tick = () => {
      controls.update();
      renderer.render(world, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();
    let down: any = null;
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const pointerUp = (e: PointerEvent) => {
      if (
        !down ||
        e.button !== 0 ||
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
      )
        return;
      const r = el.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray
        .intersectObjects(content.children)
        .find((h) => h.object.userData.key);
      callback.current(
        hit?.object.userData.key || '',
        e.shiftKey || e.ctrlKey || e.metaKey,
      );
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      world.traverse((o: any) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      renderer.dispose();
      el.replaceChildren();
      state.current = null;
    };
  }, []);
  useEffect(() => {
    const controls = state.current?.controls;
    if (!controls) return;
    const restore = () => {
      controls.mouseButtons.LEFT =
        tool === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    };
    restore();
    const down = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !(e.target as HTMLElement).closest('input,textarea,select')
      ) {
        e.preventDefault();
        controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') restore();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', restore);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', restore);
    };
  }, [tool]);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    for (const mesh of [...s.content.children]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      s.content.remove(mesh);
    }
    if (!scene) return;
    let renderIndex = 0;
    for (const cell of scene.cells.filter(
      (c: any) =>
        c.painted &&
        !c.flatOnly &&
        !c.conflict &&
        c.mode !== 'cut' &&
        c.mode !== 'through' &&
        c.enabled !== false,
    )) {
      const o = scene.creation.objects.find((o: any) => o.id === cell.objectId);
      if (!o?.visible) continue;
      const polygons =
        cell.geometry.type === 'Polygon'
          ? [cell.geometry.coordinates]
          : cell.geometry.coordinates;
      for (const rings of polygons) {
        const shape = new THREE.Shape(
          rings[0].map(([x, y]: number[]) => new THREE.Vector2(x, y)),
        );
        shape.holes = rings
          .slice(1)
          .map(
            (r: number[][]) =>
              new THREE.Path(r.map(([x, y]) => new THREE.Vector2(x, y))),
          );
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: cell.heightMM,
          bevelEnabled: false,
          steps: 1,
        });
        const material = new THREE.MeshStandardMaterial({
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1 - renderIndex++ * 0.1,
          color: cell.color,
          roughness: 0.76,
          metalness: 0,
          emissive: selected.includes(cell.key) ? '#354738' : '#000000',
          emissiveIntensity: 0.3,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.z = cell.bottomMM ?? cell.zMM ?? 0;
        mesh.userData.key = cell.key;
        s.content.add(mesh);
      }
    }
    if (!s.framed && s.content.children.length) {
      frameView('iso');
      s.framed = true;
    }
  }, [scene, selected]);
  function frameView(kind: string) {
    const s = state.current;
    if (!s) return;
    const box = new THREE.Box3().setFromObject(s.content),
      center = new THREE.Vector3(),
      size = new THREE.Vector3();
    if (box.isEmpty()) {
      center.set(0, 0, 0);
      size.set(100, 100, 5);
    } else {
      box.getCenter(center);
      box.getSize(size);
    }
    const span = Math.max(size.x, size.y, size.z, 10),
      d = (span * 1.9) / Math.min(1, s.camera.aspect);
    s.camera.near = Math.max(0.01, span / 1000);
    s.camera.far = Math.max(1000, span * 10);
    s.camera.updateProjectionMatrix();
    s.controls.target.copy(center);
    s.camera.position
      .copy(center)
      .add(
        kind === 'top'
          ? new THREE.Vector3(0, -0.001, d)
          : kind === 'side'
            ? new THREE.Vector3(0, -d, 0)
            : new THREE.Vector3(d * 0.12, -d * 0.6, d),
      );
    s.controls.update();
  }
  return (
    <div
      className="creation-3d"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div ref={host} className="creation-webgl" />
      <div className="creation-view-tools">
        <button onClick={() => frameView('iso')}>立体</button>
        <button onClick={() => frameView('top')}>正视</button>
        <button onClick={() => frameView('side')}>侧视</button>
        <span>分色预览 · 导出时合并并检查实体</span>
      </div>
      {error && <p className="model-empty">{error}</p>}
      {!scene?.cells.some((c: any) => c.painted) && (
        <p className="model-empty">先给轮廓填色，就能看到它的厚度</p>
      )}
    </div>
  );
}
