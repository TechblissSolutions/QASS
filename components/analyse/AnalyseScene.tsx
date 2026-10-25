'use client';

/**
 * Sparrow analyse — 3D "reading your website" scene (warm light theme).
 *
 * A floating website page is scanned by an orange beam; data points stream from the
 * page into a brand core that slowly wakes up. Ambient only: the analysis endpoint
 * exposes no real progress, so this never pretends to show percentages or steps.
 *
 * Fallbacks: no WebGL → `fallback` is shown. prefers-reduced-motion → one static frame.
 * Pauses when off-screen or the tab is hidden. Cursor gently tilts the whole scene.
 */

import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';

const ORANGE = '#f97316';
const CHARCOAL = '#24221f';
const TAUPE = '#77716b';

const PAGE_X = -1.9;
const CORE_X = 1.9;
const PARTICLES = 110;

type Shared = { ptr: { x: number; y: number }; reduced: boolean };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ── the website page being scanned ── */
function Page({ shared }: { shared: RefObject<Shared> }) {
  const beam = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);

  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.5, 2, 0.04)), []);
  const bars = useMemo(
    () => [
      { y: 0.62, w: 1.1, c: ORANGE },
      { y: 0.3, w: 1.1, c: TAUPE },
      { y: 0.08, w: 0.9, c: TAUPE },
      { y: -0.14, w: 1.0, c: TAUPE },
      { y: -0.36, w: 0.7, c: TAUPE },
      { y: -0.68, w: 1.1, c: '#e4dfd8' },
    ],
    [],
  );

  useFrame(({ clock }) => {
    const t = shared.current?.reduced ? 0.4 : clock.elapsedTime;
    const y = Math.sin(t * 1.1) * 0.9;
    if (beam.current) beam.current.position.y = y;
    if (glow.current) glow.current.position.y = y;
  });

  return (
    <group position={[PAGE_X, 0, 0]} rotation={[0, 0.35, 0]}>
      <mesh>
        <boxGeometry args={[1.5, 2, 0.04]} />
        <meshStandardMaterial color="#ffffff" roughness={0.6} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={CHARCOAL} transparent opacity={0.55} />
      </lineSegments>
      {bars.map((b, i) => (
        <mesh key={i} position={[-0.75 + 0.2 + b.w / 2, b.y, 0.03]}>
          <boxGeometry args={[b.w, 0.07, 0.01]} />
          <meshBasicMaterial color={b.c} />
        </mesh>
      ))}
      {/* scan beam + soft trail */}
      <mesh ref={glow} position={[0, 0, 0.05]}>
        <planeGeometry args={[1.6, 0.32]} />
        <meshBasicMaterial color={ORANGE} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh ref={beam} position={[0, 0, 0.06]}>
        <planeGeometry args={[1.64, 0.025]} />
        <meshBasicMaterial color={ORANGE} />
      </mesh>
    </group>
  );
}

/* ── data points flowing page → core ── */
function Stream({ shared }: { shared: RefObject<Shared> }) {
  const ref = useRef<THREE.Points>(null);

  const data = useMemo(() => {
    const progress = new Float32Array(PARTICLES);
    const speed = new Float32Array(PARTICLES);
    const sy = new Float32Array(PARTICLES);
    const sz = new Float32Array(PARTICLES);
    const positions = new Float32Array(PARTICLES * 3);
    const colors = new Float32Array(PARTICLES * 3);
    const cA = new THREE.Color(ORANGE);
    const cB = new THREE.Color(CHARCOAL);
    for (let i = 0; i < PARTICLES; i++) {
      progress[i] = Math.random();
      speed[i] = 0.12 + Math.random() * 0.16;
      sy[i] = (Math.random() - 0.5) * 1.7;
      sz[i] = Math.random() * 0.8 - 0.2;
      const c = Math.random() < 0.7 ? cA : cB;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return { progress, speed, sy, sz, positions, colors };
  }, []);

  useFrame((_, delta) => {
    const pts = ref.current;
    if (!pts) return;
    const dt = shared.current?.reduced ? 0 : Math.min(delta, 0.05);
    const { progress, speed, sy, sz, positions } = data;

    for (let i = 0; i < PARTICLES; i++) {
      progress[i] = (progress[i] + speed[i] * dt) % 1;
      const u = progress[i];
      const v = 1 - u;
      const ax = PAGE_X + 0.55;
      const ay = sy[i];
      const cx = 0;
      const cy = sy[i] * 0.5 + Math.sin(i * 1.7) * 0.9;
      const cz = 0.5 + sz[i];
      const bx = CORE_X;
      // quadratic bezier: page → arc → core
      positions[i * 3] = v * v * ax + 2 * v * u * cx + u * u * bx;
      positions[i * 3 + 1] = v * v * ay + 2 * v * u * cy;
      positions[i * 3 + 2] = v * v * 0.1 + 2 * v * u * cz;
    }
    (pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.06} sizeAttenuation vertexColors transparent opacity={0.95} depthWrite={false} />
    </points>
  );
}

/* ── brand core that slowly wakes up ── */
function Core({ shared }: { shared: RefObject<Shared> }) {
  const spin = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const seed = useRef<THREE.Mesh>(null);

  useFrame(({ clock }, delta) => {
    const reduced = shared.current?.reduced;
    const t = reduced ? 0 : clock.elapsedTime;
    const dt = reduced ? 0 : Math.min(delta, 0.05);
    if (spin.current) {
      spin.current.rotation.y += dt * 0.6;
      spin.current.rotation.x += dt * 0.2;
    }
    if (ring.current) ring.current.rotation.z += dt * 0.9;
    if (seed.current) seed.current.scale.setScalar(0.38 + Math.sin(t * 2.2) * 0.04 + Math.min(t / 40, 0.12));
  });

  return (
    <group position={[CORE_X, 0, 0]}>
      <group ref={spin}>
        <mesh>
          <icosahedronGeometry args={[0.62, 1]} />
          <meshStandardMaterial color={CHARCOAL} roughness={0.45} metalness={0.3} flatShading />
        </mesh>
        <mesh scale={1.06}>
          <icosahedronGeometry args={[0.62, 1]} />
          <meshBasicMaterial color={ORANGE} wireframe transparent opacity={0.9} />
        </mesh>
        <mesh ref={seed} scale={0.4}>
          <icosahedronGeometry args={[0.62, 2]} />
          <meshBasicMaterial color={ORANGE} />
        </mesh>
      </group>
      <mesh ref={ring} rotation={[1.25, 0.2, 0]}>
        <torusGeometry args={[1.0, 0.012, 8, 120]} />
        <meshBasicMaterial color={ORANGE} transparent opacity={0.75} />
      </mesh>
    </group>
  );
}

/* ── scene root: cursor tilt + responsive fit ── */
function Scene({ shared }: { shared: RefObject<Shared> }) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ viewport }) => {
    const g = group.current;
    const s = shared.current;
    if (!g || !s) return;
    const tx = s.reduced ? 0 : s.ptr.x;
    const ty = s.reduced ? 0 : s.ptr.y;
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, tx * 0.35, 0.06);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, -ty * 0.2, 0.06);
    g.scale.setScalar(clamp(viewport.width / 7.6, 0.55, 1.15));
  });

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[2, 3, 4]} intensity={1.1} />
      <group ref={group}>
        <Page shared={shared} />
        <Stream shared={shared} />
        <Core shared={shared} />
      </group>
    </>
  );
}

export default function AnalyseScene({ fallback }: { fallback?: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const shared = useRef<Shared>({ ptr: { x: 0, y: 0 }, reduced: false });
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;

    try {
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
    } catch {
      return;
    }

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    shared.current.reduced = mq.matches;
    setReduced(mq.matches);
    setReady(true);

    const onMotion = (e: MediaQueryListEvent) => {
      shared.current.reduced = e.matches;
      setReduced(e.matches);
    };
    mq.addEventListener('change', onMotion);

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      shared.current.ptr.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      shared.current.ptr.y = clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1, 1);
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    let inView = true;
    const sync = () => setVisible(inView && !document.hidden);
    const io = new IntersectionObserver(entries => {
      inView = entries[0]?.isIntersecting ?? true;
      sync();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', sync);

    return () => {
      mq.removeEventListener('change', onMotion);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', sync);
      io.disconnect();
    };
  }, []);

  return (
    <div ref={wrap} className="analyse-scene" role="img" aria-label="Animation: Sparrow is reading your website">
      {ready ? (
        <Canvas
          frameloop={reduced ? 'demand' : visible ? 'always' : 'never'}
          dpr={[1, 1.75]}
          camera={{ position: [0, 0, 4.2], fov: 40 }}
          gl={{ antialias: true, alpha: true }}
        >
          <Scene shared={shared} />
        </Canvas>
      ) : (
        fallback ?? null
      )}
    </div>
  );
}
