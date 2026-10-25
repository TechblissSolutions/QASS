'use client';

/**
 * Sparrow landing — interactive 3D hero scene.
 *
 * What the user sees (all in the existing dark landing palette):
 *  - A glowing "brand core" on the right side of the hero, wrapped by three tilted
 *    orbit rings. Four nodes travel the rings: research → brand context → content → plan.
 *  - A full-hero particle field that is pushed away by the cursor.
 *  - Cursor tilts the core, click sends a pulse + ripple, scroll pushes the core back.
 *
 * Safe-guards: WebGL check, pauses off-screen / hidden tab, prefers-reduced-motion
 * renders one static frame, fewer particles on small or low-core devices.
 *
 * `energy` (0–1) speeds the core up. Reuse this later on the dashboard
 * (e.g. energy={isGenerating ? 1 : 0.2}).
 */

import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';

const ORANGE = '#ff4b13';
const LIME = '#c8f169';
const WHITE = '#ffffff';

type SceneState = {
  ptr: { x: number; y: number; active: boolean };
  pulse: number;
  pulseId: number;
  scroll: number;
  reduced: boolean;
  energy: number;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ───────────────────────── Particle field (reacts to cursor) ───────────────────────── */

function Field({ count, state }: { count: number; state: RefObject<SceneState> }) {
  const ref = useRef<THREE.Points>(null);

  const { base, positions, colors } = useMemo(() => {
    const base = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cOrange = new THREE.Color(ORANGE);
    const cLime = new THREE.Color(LIME);
    const cWhite = new THREE.Color(WHITE);
    for (let i = 0; i < count; i++) {
      // x / y stored as -0.5..0.5 and scaled to the viewport every frame (resize-safe)
      base[i * 3] = Math.random() - 0.5;
      base[i * 3 + 1] = Math.random() - 0.5;
      base[i * 3 + 2] = Math.random() * 4.5 - 3;
      const r = Math.random();
      const c = r < 0.42 ? cOrange : r < 0.68 ? cLime : cWhite;
      const dim = 0.3 + Math.random() * 0.7;
      colors[i * 3] = c.r * dim;
      colors[i * 3 + 1] = c.g * dim;
      colors[i * 3 + 2] = c.b * dim;
    }
    positions.set(base);
    return { base, positions, colors };
  }, [count]);

  useFrame(({ clock, viewport }) => {
    const pts = ref.current;
    const st = state.current;
    if (!pts || !st) return;

    const t = st.reduced ? 0 : clock.elapsedTime;
    const { width, height } = viewport;
    const hasPtr = st.ptr.active && !st.reduced;
    const px = hasPtr ? st.ptr.x * (width / 2) : 1e4;
    const py = hasPtr ? st.ptr.y * (height / 2) : 1e4;
    const radius = 1.7 + st.pulse * 1.8;
    const r2 = radius * radius;

    const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      let x = base[i3] * width * 1.08 + Math.sin(t * 0.25 + i) * 0.1;
      let y = base[i3 + 1] * height * 1.08 + Math.cos(t * 0.2 + i * 1.3) * 0.1;
      const dx = x - px;
      const dy = y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const d = Math.sqrt(d2) || 0.0001;
        const f = 1 - d / radius;
        const push = f * f * 1.15;
        x += (dx / d) * push;
        y += (dy / d) * push;
      }
      arr[i3] = x;
      arr[i3 + 1] = y;
      arr[i3 + 2] = base[i3 + 2];
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/* ───────────────────────── Brand core + orbit rings ───────────────────────── */

const RINGS = [
  { r: 1.55, tilt: [1.2, 0.2, 0.0] as const, speed: 0.5, color: ORANGE, nodes: [0, Math.PI] },
  { r: 1.95, tilt: [0.5, 0.9, 0.3] as const, speed: -0.35, color: LIME, nodes: [1.4] },
  { r: 2.35, tilt: [-0.9, 0.3, 0.6] as const, speed: 0.25, color: WHITE, nodes: [3.9] },
];

function Core({ state }: { state: RefObject<SceneState> }) {
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const bodyMat = useRef<THREE.MeshStandardMaterial>(null);
  const halo1 = useRef<THREE.MeshBasicMaterial>(null);
  const halo2 = useRef<THREE.MeshBasicMaterial>(null);
  const ripple = useRef<THREE.Mesh>(null);
  const rippleMat = useRef<THREE.MeshBasicMaterial>(null);
  const arms = useRef<(THREE.Group | null)[]>([]);
  const sm = useRef({ x: 0, y: 0, ripple: 1, lastPulseId: 0 });

  useFrame(({ clock, viewport }, delta) => {
    const st = state.current;
    if (!st || !root.current || !tilt.current || !spin.current) return;

    const t = st.reduced ? 0 : clock.elapsedTime;
    const dt = st.reduced ? 0 : Math.min(delta, 0.05);
    const s = sm.current;

    // smooth pointer (0 when the cursor is not over the page)
    const tx = st.ptr.active && !st.reduced ? st.ptr.x : 0;
    const ty = st.ptr.active && !st.reduced ? st.ptr.y : 0;
    s.x += (tx - s.x) * Math.min(1, dt * 3);
    s.y += (ty - s.y) * Math.min(1, dt * 3);

    st.pulse = Math.max(0, st.pulse - dt * 1.4);
    if (st.pulseId !== s.lastPulseId) {
      s.lastPulseId = st.pulseId;
      s.ripple = 0;
    }

    const p = st.scroll;
    const { width } = viewport;
    const fit = clamp(width / 9.5, 0.55, 1.1);
    const pulseEase = st.pulse * st.pulse;

    // placement: right side of the hero, drifts up and back on scroll
    root.current.position.set(width * 0.2 + s.x * 0.15, p * 1.2 + s.y * 0.1, -p * 1.6);
    root.current.scale.setScalar(fit * (1 - p * 0.25) * (1 + pulseEase * 0.18));

    // cursor tilt
    tilt.current.rotation.x = THREE.MathUtils.lerp(tilt.current.rotation.x, -s.y * 0.55, 0.08);
    tilt.current.rotation.y = THREE.MathUtils.lerp(tilt.current.rotation.y, s.x * 0.8, 0.08);

    // spin speed: base + agent energy + scroll + click pulse
    spin.current.rotation.y += dt * (0.25 + st.energy * 0.9 + p * 1.2 + st.pulse * 2.2);
    spin.current.rotation.x += dt * 0.12;

    if (bodyMat.current) {
      bodyMat.current.emissiveIntensity = 0.38 + st.pulse * 1.1 + Math.sin(t * 1.6) * 0.06 + st.energy * 0.3;
    }
    if (halo1.current) halo1.current.opacity = 0.1 + st.pulse * 0.12;
    if (halo2.current) halo2.current.opacity = 0.05 + st.pulse * 0.08;

    // nodes travelling the rings
    RINGS.forEach((ring, i) => {
      const arm = arms.current[i];
      if (arm) arm.rotation.z = t * ring.speed * (1 + st.energy * 2.5 + p);
    });

    // click ripple
    if (ripple.current && rippleMat.current) {
      if (s.ripple < 1) {
        s.ripple = Math.min(1, s.ripple + dt * 0.9);
        const e = 1 - Math.pow(1 - s.ripple, 3);
        ripple.current.scale.setScalar(1 + e * 4.2);
        rippleMat.current.opacity = (1 - s.ripple) * 0.55;
      } else {
        rippleMat.current.opacity = 0;
      }
    }
  });

  return (
    <group ref={root}>
      <group ref={tilt}>
        <group ref={spin}>
          {/* solid core */}
          <mesh>
            <icosahedronGeometry args={[0.95, 1]} />
            <meshStandardMaterial
              ref={bodyMat}
              color="#1a0d08"
              emissive={ORANGE}
              emissiveIntensity={0.38}
              roughness={0.35}
              metalness={0.6}
              flatShading
            />
          </mesh>
          {/* lime wire cage */}
          <mesh scale={1.04}>
            <icosahedronGeometry args={[0.95, 1]} />
            <meshBasicMaterial color={LIME} wireframe transparent opacity={0.45} />
          </mesh>
          {/* inner bright seed */}
          <mesh scale={0.42}>
            <icosahedronGeometry args={[0.95, 2]} />
            <meshBasicMaterial color={ORANGE} transparent opacity={0.9} />
          </mesh>
        </group>

        {/* additive halos (fake bloom) */}
        <mesh scale={1.45}>
          <sphereGeometry args={[0.95, 32, 32]} />
          <meshBasicMaterial
            ref={halo1}
            color={ORANGE}
            transparent
            opacity={0.1}
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh scale={1.9}>
          <sphereGeometry args={[0.95, 32, 32]} />
          <meshBasicMaterial
            ref={halo2}
            color={ORANGE}
            transparent
            opacity={0.05}
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        {/* orbit rings + travelling nodes */}
        {RINGS.map((ring, i) => (
          <group key={i} rotation={[ring.tilt[0], ring.tilt[1], ring.tilt[2]]}>
            <mesh>
              <torusGeometry args={[ring.r, 0.006, 8, 160]} />
              <meshBasicMaterial color={ring.color} transparent opacity={0.4} />
            </mesh>
            <group
              ref={el => {
                arms.current[i] = el;
              }}
            >
              {ring.nodes.map((offset, n) => (
                <group key={n} rotation={[0, 0, offset]}>
                  <mesh position={[ring.r, 0, 0]}>
                    <sphereGeometry args={[0.075, 16, 16]} />
                    <meshBasicMaterial color={ring.color} />
                  </mesh>
                  <mesh position={[ring.r, 0, 0]}>
                    <sphereGeometry args={[0.2, 16, 16]} />
                    <meshBasicMaterial
                      color={ring.color}
                      transparent
                      opacity={0.18}
                      blending={THREE.AdditiveBlending}
                      depthWrite={false}
                    />
                  </mesh>
                </group>
              ))}
            </group>
          </group>
        ))}
      </group>

      {/* click ripple (faces the camera) */}
      <mesh ref={ripple}>
        <ringGeometry args={[1.0, 1.03, 96]} />
        <meshBasicMaterial
          ref={rippleMat}
          color={LIME}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ───────────────────────── Scene + wrapper ───────────────────────── */

function Scene({ state, count }: { state: RefObject<SceneState>; count: number }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 2, 5]} intensity={55} color={ORANGE} />
      <pointLight position={[-4, -2, 3]} intensity={25} color={LIME} />
      <Field count={count} state={state} />
      <Core state={state} />
    </>
  );
}

export default function HeroScene({ energy = 0.2 }: { energy?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const state = useRef<SceneState>({
    ptr: { x: 0, y: 0, active: false },
    pulse: 0,
    pulseId: 0,
    scroll: 0,
    reduced: false,
    energy,
  });
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [count, setCount] = useState(700);

  useEffect(() => {
    state.current.energy = clamp(energy, 0, 1);
  }, [energy]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;

    // 1) needs WebGL, otherwise the hero simply stays as it was
    try {
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
    } catch {
      return;
    }

    // 2) device + motion preferences
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    state.current.reduced = mq.matches;
    setReduced(mq.matches);
    const lowPower = window.innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4;
    setCount(lowPower ? 320 : 760);
    setReady(true);

    const onMotionChange = (e: MediaQueryListEvent) => {
      state.current.reduced = e.matches;
      setReduced(e.matches);
    };
    mq.addEventListener('change', onMotionChange);

    // 3) cursor
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      state.current.ptr.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.2, 1.2);
      state.current.ptr.y = clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1.2, 1.2);
      state.current.ptr.active = true;
    };
    const onLeave = (e: MouseEvent) => {
      if (!e.relatedTarget) state.current.ptr.active = false;
    };

    // 4) click → pulse (ignored on links, buttons and inputs)
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('a, button, input, textarea, select, label')) return;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      state.current.pulse = 1;
      state.current.pulseId += 1;
    };

    // 5) scroll → push the core back and fade the scene out
    const onScroll = () => {
      const h = el.offsetHeight || 1;
      const p = clamp(window.scrollY / h, 0, 1);
      state.current.scroll = p;
      const base = window.innerWidth < 900 ? 0.55 : 1;
      el.style.opacity = String(base * (1 - p * 0.85));
    };
    onScroll();

    // 6) pause when off-screen or tab hidden
    let inView = true;
    const sync = () => setVisible(inView && !document.hidden);
    const io = new IntersectionObserver(entries => {
      inView = entries[0]?.isIntersecting ?? true;
      sync();
    });
    io.observe(el);

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('mouseout', onLeave);
    document.addEventListener('visibilitychange', sync);

    return () => {
      mq.removeEventListener('change', onMotionChange);
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('mouseout', onLeave);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return (
    <div ref={wrap} className="landing-v6-scene" aria-hidden="true">
      {ready && (
        <Canvas
          frameloop={reduced ? 'demand' : visible ? 'always' : 'never'}
          dpr={[1, 1.75]}
          camera={{ position: [0, 0, 8], fov: 40 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        >
          <Scene state={state} count={count} />
        </Canvas>
      )}
    </div>
  );
}
