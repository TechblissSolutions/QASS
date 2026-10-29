'use client';

/**
 * Sparrow ambient backdrop — always-on, low-key 3D motion behind app pages.
 *
 * Nothing here needs a click: particles drift upward, a large wireframe form and a thin
 * ring turn slowly at the page edges, small shapes float, and the whole scene shifts with
 * the cursor and with page scroll (parallax).
 *
 * Built to stay out of the way:
 *  - drawn on the warm canvas behind panels, low opacity, never intercepts pointer events
 *  - 30 fps cap, pauses when the tab is hidden, cheap renderer settings
 *  - prefers-reduced-motion → one static frame
 *  - colour = the company's `--client-primary` when inside a company workspace
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';

const FALLBACK_ACCENT = '#d03e7c';
const TAUPE = '#77716b';

type Live = {
  px: number;
  py: number;
  scroll: number;
  reduced: boolean;
  /** pointer-velocity impulse (world axes), consumed by <Spring /> each frame */
  ix: number;
  iy: number;
  /** spring state: stretch vector (s*) and its rate (v*) */
  sx: number;
  sy: number;
  vx: number;
  vy: number;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function readAccent(): THREE.Color {
  const color = new THREE.Color(FALLBACK_ACCENT);
  try {
    const host = (document.querySelector('.company-workspace') as HTMLElement | null) ?? document.documentElement;
    const raw = getComputedStyle(host).getPropertyValue('--client-primary').trim();
    if (raw && typeof CSS !== 'undefined' && CSS.supports('color', raw)) {
      color.setStyle(raw);
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      if (hsl.l > 0.62) color.setHSL(hsl.h, hsl.s, 0.52); // stay visible on the light canvas
    }
  } catch {
    /* keep fallback */
  }
  return color;
}

/** 30 fps ticker: the canvas renders on demand so it never burns a full 60 fps. */
function Ticker({ active }: { active: boolean }) {
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    invalidate();
    if (!active) return;
    const id = window.setInterval(() => invalidate(), 1000 / 30);
    return () => window.clearInterval(id);
  }, [active, invalidate]);
  return null;
}

/** Eases the pointer position (sx, sy in -1..1) so everything follows the cursor softly, with no wobble. */
function Spring({ live }: { live: RefObject<Live> }) {
  useFrame((_, delta) => {
    const l = live.current;
    const dt = Math.min(delta, 0.05);
    const tx = l.reduced ? 0 : l.px;
    const ty = l.reduced ? 0 : l.py;
    const e = 1 - Math.exp(-dt * 2.6);
    l.sx += (tx - l.sx) * e;
    l.sy += (ty - l.sy) * e;
  });
  return null;
}

/** Centre-of-gravity pull: the child leans a tiny bit toward the cursor and elongates a hair, then eases back. */
function Stretchy({ live, gain, posRef, children }: { live: RefObject<Live>; gain: number; posRef: RefObject<THREE.Group | null>; children: ReactNode }) {
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  const c = useRef<THREE.Group>(null);
  const st = useRef({ x: 0, y: 0, k: 0 });
  useFrame(({ viewport }, delta) => {
    const l = live.current;
    if (!a.current || !b.current || !c.current) return;
    const dt = Math.min(delta, 0.05);
    const o = posRef.current?.position;
    // cursor in world space (z = 0 plane), measured from this object's own centre
    const dx = l.sx * (viewport.width / 2) - (o?.x ?? 0);
    const dy = l.sy * (viewport.height / 2) - (o?.y ?? 0);
    const dist = Math.hypot(dx, dy) || 1;
    const near = 1 / (1 + dist * 0.25); // closer to the cursor = slightly stronger pull
    const pull = Math.min(dist * 0.018, 0.14) * gain; // world units, tiny
    const tx = l.reduced ? 0 : (dx / dist) * pull;
    const ty = l.reduced ? 0 : (dy / dist) * pull;
    const tk = l.reduced ? 0 : 0.045 * near * gain; // max ~4% elongation
    const e = 1 - Math.exp(-dt * 3);
    const s = st.current;
    s.x += (tx - s.x) * e;
    s.y += (ty - s.y) * e;
    s.k += (tk - s.k) * e;
    const ang = Math.atan2(dy, dx);
    a.current.position.set(s.x, s.y, 0);
    a.current.rotation.z = ang;
    c.current.rotation.z = -ang;
    b.current.scale.set(1 + s.k, 1 / Math.sqrt(1 + s.k), 1 / Math.sqrt(1 + s.k));
  });
  return (
    <group ref={posRef}>
      <group ref={a}>
        <group ref={b}>
          <group ref={c}>{children}</group>
        </group>
      </group>
    </group>
  );
}

function Particles({ count, accent, live }: { count: number; accent: THREE.Color; live: RefObject<Live> }) {
  const ref = useRef<THREE.Points>(null);

  const data = useMemo(() => {
    const base = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const taupe = new THREE.Color(TAUPE);
    for (let i = 0; i < count; i++) {
      base[i * 3] = Math.random() - 0.5;
      base[i * 3 + 1] = Math.random();
      base[i * 3 + 2] = Math.random() * 2.5 - 2.5;
      speed[i] = 0.006 + Math.random() * 0.014;
      const c = Math.random() < 0.3 ? accent : taupe;
      const dim = 0.7 + Math.random() * 0.3;
      colors[i * 3] = c.r * dim;
      colors[i * 3 + 1] = c.g * dim;
      colors[i * 3 + 2] = c.b * dim;
    }
    positions.set(base);
    return { base, speed, positions, colors };
  }, [count, accent]);

  useFrame(({ clock, viewport }) => {
    const pts = ref.current;
    if (!pts) return;
    const t = live.current.reduced ? 0 : clock.elapsedTime;
    const { width, height } = viewport;
    const { base, speed, positions } = data;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const y01 = (base[i3 + 1] + t * speed[i]) % 1; // loops bottom → top forever
      const depth = base[i3 + 2] + 3; // 0.5 (far) .. 3 (near)
      const L = live.current;
      const px0 = base[i3] * width * 1.2 + Math.sin(t * 0.3 + i) * 0.08;
      const py0 = (y01 - 0.5) * height * 1.25;
      // gentle gravity toward the cursor; nearer dots lean a touch more (max ~2%)
      positions[i3] = px0 + (L.sx * width * 0.5 - px0) * 0.007 * depth;
      positions[i3 + 1] = py0 + (L.sy * height * 0.5 - py0) * 0.007 * depth;
      positions[i3 + 2] = base[i3 + 2];
    }
    (pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.04} sizeAttenuation vertexColors transparent opacity={0.55} depthWrite={false} />
    </points>
  );
}

const FLOATERS = [
  { x: -0.3, y: 0.28, z: -0.6, s: 1.0 },
  { x: 0.18, y: -0.3, z: -1.0, s: 1.4 },
  { x: -0.12, y: -0.12, z: -0.3, s: 0.8 },
];

function Forms({ accent, live }: { accent: THREE.Color; live: RefObject<Live> }) {
  const big = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const floaters = useRef<(THREE.Mesh | null)[]>([]);
  const bigPos = useRef<THREE.Group>(null);
  const ringPos = useRef<THREE.Group>(null);
  const floaterPos = useRef<(THREE.Group | null)[]>([]);

  useFrame(({ clock, camera, viewport }, delta) => {
    const l = live.current;
    const t = l.reduced ? 0 : clock.elapsedTime;
    const dt = l.reduced ? 0 : Math.min(delta, 0.1);
    const { width, height } = viewport;

    // parallax: cursor + scroll nudge the camera a little
    const px = l.reduced ? 0 : l.px;
    const py = l.reduced ? 0 : l.py;
    camera.position.x += (px * 0.35 - camera.position.x) * 0.05;
    camera.position.y += (py * 0.2 - l.scroll * 2.2 - camera.position.y) * 0.05;
    camera.lookAt(0, 0, 0);

    bigPos.current?.position.set(width * 0.46, height * 0.06, -1);
    ringPos.current?.position.set(-width * 0.42, -height * 0.34, -1.5);
    if (big.current) {
      big.current.rotation.y += dt * 0.07;
      big.current.rotation.x += dt * 0.035;
    }
    if (ring.current) {
      ring.current.rotation.x = 1.1 + Math.sin(t * 0.15) * 0.15;
      ring.current.rotation.z += dt * 0.12;
    }
    floaters.current.forEach((m, i) => {
      if (!m) return;
      const f = FLOATERS[i];
      floaterPos.current[i]?.position.set(f.x * width + Math.sin(t * 0.35 + i * 2) * 0.2, f.y * height + Math.sin(t * 0.5 + i) * 0.28, f.z);
      m.rotation.x += dt * 0.25;
      m.rotation.y += dt * 0.18;
    });
  });

  return (
    <>
      <Stretchy live={live} gain={0.6} posRef={bigPos}>
        <mesh ref={big}>
          <icosahedronGeometry args={[2.6, 1]} />
          <meshBasicMaterial color={accent} wireframe transparent opacity={0.14} />
        </mesh>
      </Stretchy>
      <Stretchy live={live} gain={0.8} posRef={ringPos}>
        <mesh ref={ring}>
          <torusGeometry args={[1.9, 0.012, 8, 140]} />
          <meshBasicMaterial color={TAUPE} transparent opacity={0.28} />
        </mesh>
      </Stretchy>
      {FLOATERS.map((f, i) => (
        <Stretchy
          key={i}
          live={live}
          gain={1.2}
          posRef={{
            get current() {
              return floaterPos.current[i];
            },
            set current(v) {
              floaterPos.current[i] = v;
            },
          }}
        >
          <mesh
            scale={f.s}
            ref={el => {
              floaters.current[i] = el;
            }}
          >
            <octahedronGeometry args={[0.2, 0]} />
            <meshBasicMaterial color={accent} wireframe transparent opacity={0.4} />
          </mesh>
        </Stretchy>
      ))}
    </>
  );
}

export default function AmbientCanvas({ routeKey }: { routeKey: string }) {
  const live = useRef<Live>({ px: 0, py: 0, scroll: 0, reduced: false, ix: 0, iy: 0, sx: 0, sy: 0, vx: 0, vy: 0 });
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [count, setCount] = useState(70);
  const [accent, setAccent] = useState(() => new THREE.Color(FALLBACK_ACCENT));

  // Keep ambient colours in sync with the active company's theme, including project
  // switches that happen without a route change. The canvas motion itself is unchanged.
  useEffect(() => {
    const syncAccent = () => {
      const next = readAccent();
      setAccent(current => current.equals(next) ? current : next);
    };
    const initialSync = window.setTimeout(syncAccent, 450);
    const observer = new MutationObserver(syncAccent);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    return () => {
      window.clearTimeout(initialSync);
      observer.disconnect();
    };
  }, [routeKey]);

  useEffect(() => {
    try {
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
    } catch {
      return;
    }

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    live.current.reduced = mq.matches;
    setReduced(mq.matches);
    setCount(window.innerWidth < 768 || (navigator.hardwareConcurrency || 8) <= 4 ? 36 : 70);
    setAccent(readAccent());
    setReady(true);

    const onMotion = (e: MediaQueryListEvent) => {
      live.current.reduced = e.matches;
      setReduced(e.matches);
    };
    mq.addEventListener('change', onMotion);

    const onMove = (e: PointerEvent) => {
      live.current.px = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
      live.current.py = clamp(-((e.clientY / window.innerHeight) * 2 - 1), -1, 1);
    };
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      live.current.scroll = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
    };
    const onVisibility = () => setVisible(!document.hidden);

    onScroll();
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mq.removeEventListener('change', onMotion);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!ready) return null;

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 7], fov: 40 }}
      gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
    >
      <Ticker active={visible && !reduced} />
      <Spring live={live} />
      <Particles count={count} accent={accent} live={live} />
      <Forms accent={accent} live={live} />
    </Canvas>
  );
}
