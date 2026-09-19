'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pickVisibleIntersection } from '@/lib/creation-pick.mjs';

type Coordinate = [number, number];
type CreationCell = {
  key: string;
  objectId: string;
  painted?: boolean;
  flatOnly?: boolean;
  conflict?: boolean;
  mode?: string;
  enabled?: boolean;
  geometry:
    | { type: 'Polygon'; coordinates: Coordinate[][] }
    | { type: 'MultiPolygon'; coordinates: Coordinate[][][] };
  heightMM: number;
  bottomMM?: number;
  zMM?: number;
  color: string;
};
type CreationScene = {
  cells: CreationCell[];
  creation: { objects: { id: string; visible: boolean }[] };
};
type PointerStart = {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
};
type ViewState = {
  renderer: THREE.WebGLRenderer;
  world: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  framed: boolean;
  interaction: {
    tool: string;
    spaceDown: boolean;
    down: PointerStart | null;
    pointers: Set<number>;
  };
};
const setLeftMouseAction = (controls: OrbitControls, action: THREE.MOUSE) => {
  controls.mouseButtons.LEFT = action;
};
export default function CreationView({
  scene,
  selected,
  onSelect,
  tool,
}: {
  scene: CreationScene | null;
  selected: string[];
  onSelect: (
    key: string,
    modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => void;
  tool: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef<ViewState | null>(null),
    callback = useRef(onSelect),
    [error, setError] = useState('');
  useEffect(() => {
    callback.current = onSelect;
  }, [onSelect]);
  const frameView = useCallback((kind: string) => {
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
  }, []);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      queueMicrotask(() =>
        setError('三维显示不可用，请启用硬件加速；仍可编辑平面和导出。'),
      );
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
    const s: ViewState = {
      renderer,
      world,
      camera,
      controls,
      content,
      framed: false,
      interaction: {
        tool: 'select',
        spaceDown: false,
        down: null,
        pointers: new Set<number>(),
      },
    };
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
    const pointerDown = (e: PointerEvent) => {
      const interaction = s.interaction;
      interaction.pointers.add(e.pointerId);
      interaction.down =
        e.isPrimary &&
        e.button === 0 &&
        interaction.pointers.size === 1 &&
        interaction.tool !== 'pan' &&
        !interaction.spaceDown
          ? { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
          : null;
    };
    const pointerMove = (e: PointerEvent) => {
      const down = s.interaction.down;
      if (
        down?.pointerId === e.pointerId &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 4
      )
        down.moved = true;
    };
    const pointerUp = (e: PointerEvent) => {
      s.interaction.pointers.delete(e.pointerId);
      const down = s.interaction.down;
      if (!down || e.pointerId !== down.pointerId) return;
      // Always consume our gesture first.  OrbitControls may capture this
      // release outside the canvas, and a stale down must never select later.
      s.interaction.down = null;
      if (
        e.button !== 0 ||
        s.interaction.tool === 'pan' ||
        s.interaction.spaceDown ||
        down.moved
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
      const hit = pickVisibleIntersection(
        ray.intersectObjects(content.children),
      );
      callback.current(hit?.object.userData.key || '', {
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      });
    };
    const clearPointer = (e: PointerEvent) => {
      s.interaction.pointers.delete(e.pointerId);
      if (s.interaction.down?.pointerId === e.pointerId)
        s.interaction.down = null;
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', clearPointer);
    renderer.domElement.addEventListener('lostpointercapture', clearPointer);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      world.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', clearPointer);
      renderer.domElement.removeEventListener(
        'lostpointercapture',
        clearPointer,
      );
      renderer.dispose();
      el.replaceChildren();
      state.current = null;
    };
  }, []);
  useEffect(() => {
    const current = state.current;
    if (!current) return;
    const { controls, interaction } = current;
    interaction.tool = tool;
    interaction.down = null;
    interaction.pointers.clear();
    const restore = () => {
      setLeftMouseAction(
        controls,
        tool === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
      );
    };
    restore();
    const down = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !(e.target as HTMLElement).closest('input,textarea,select')
      ) {
        e.preventDefault();
        setLeftMouseAction(controls, THREE.MOUSE.PAN);
        interaction.spaceDown = true;
        interaction.down = null;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        interaction.spaceDown = false;
        restore();
      }
    };
    const blur = () => {
      interaction.spaceDown = false;
      interaction.down = null;
      interaction.pointers.clear();
      restore();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [tool]);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    for (const child of s.content.children.slice()) {
      if (!(child instanceof THREE.Mesh)) continue;
      const mesh = child;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      materials.forEach((material) => material.dispose());
      s.content.remove(mesh);
    }
    if (!scene) return;
    let renderIndex = 0;
    for (const cell of scene.cells.filter(
      (c) =>
        c.painted &&
        !c.flatOnly &&
        !c.conflict &&
        c.mode !== 'cut' &&
        c.mode !== 'through' &&
        c.enabled !== false,
    )) {
      const o = scene.creation.objects.find((o) => o.id === cell.objectId);
      if (!o?.visible) continue;
      const polygons =
        cell.geometry.type === 'Polygon'
          ? [cell.geometry.coordinates]
          : cell.geometry.coordinates;
      for (const rings of polygons) {
        const pickOrder = renderIndex++;
        const shape = new THREE.Shape(
          rings[0].map(([x, y]) => new THREE.Vector2(x, y)),
        );
        shape.holes = rings
          .slice(1)
          .map(
            (ring) =>
              new THREE.Path(ring.map(([x, y]) => new THREE.Vector2(x, y))),
          );
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: cell.heightMM,
          bevelEnabled: false,
          steps: 1,
        });
        const material = new THREE.MeshStandardMaterial({
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1 - pickOrder * 0.1,
          color: cell.color,
          roughness: 0.76,
          metalness: 0,
          emissive: selected.includes(cell.key) ? '#354738' : '#000000',
          emissiveIntensity: 0.3,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.z = cell.bottomMM ?? cell.zMM ?? 0;
        mesh.userData.key = cell.key;
        // This explicit ordering keeps draw order and picking order aligned.
        mesh.userData.pickOrder = pickOrder;
        mesh.renderOrder = pickOrder;
        s.content.add(mesh);
      }
    }
    if (!s.framed && s.content.children.length) {
      frameView('iso');
      s.framed = true;
    }
  }, [frameView, scene, selected]);
  // OrbitControls receives captured drag and release events on document.
  // Only isolate pointer-down; movement and pointer-up must keep bubbling.
  return (
    <div
      className="creation-3d"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div ref={host} className="creation-webgl" />
      <div className="creation-view-tools">
        <button onClick={() => frameView('iso')}>立体</button>
        <button onClick={() => frameView('top')}>正视</button>
        <button onClick={() => frameView('side')}>侧视</button>
        <span>分色预览 · 导出时合并并检查实体</span>
      </div>
      {error && <p className="model-empty">{error}</p>}
      {!scene?.cells.some((cell) => cell.painted) && (
        <p className="model-empty">先给轮廓填色，就能看到它的厚度</p>
      )}
    </div>
  );
}
