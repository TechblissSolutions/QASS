'use client';

/**
 * Sparrow Create — 3D "generating" scene shown in the results panel while a
 * request is running.
 *
 * A core sits in the middle of a ring of result slots. Real progress only:
 *  - `total` = how many results were requested (0 = unknown, shows 3 slots)
 *  - `done`  = how many have actually arrived → those slots fill and pop
 *  - the next pending slot pulses to show the workflow is still working
 *
 * Colour: reads the company's `--client-primary` from the page (see DESIGN.md:
 * company accents stay inside the company workspace), falls back to Sparrow orange.
 *
 * Fallbacks: no WebGL → renders nothing (the existing text status stays).
 * prefers-reduced-motion → static frame. Pauses when off-screen / tab hidden.
 */

import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';

const FALLBACK_ACCENT = '#d03e7c';
const CHARCOAL = '#24221f';
const TAUPE = '#77716b';

type Kind = 'image' | 'video' | 'email';
type Live = { done: number; total: number; reduced: boolean; ptr: { x: number; y: number } };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const TILE_SIZE: Record<Kind, [number, number]> = {
  image: [0.62, 0.62],
  video: [0.4, 0.7],
  email: [0.78, 0.52],
};

function Ring({ kind, accent, live }: { kind: Kind; accent: THREE.Color; live: RefObject<Live> }) {
  const slots = clamp(live.current.total || 3, 1, 8);
  const [w, h] = TILE_SIZE[kind];

  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const seed = useRef<THREE.Mesh>(null);
  const tiles = useRef<(THREE.Group | null)[]>([]);
  const fills = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const edgeMats = useRef<(THREE.LineBasicMaterial | null)[]>([]);
  const pop = useRef<number[]>(Array.from({ length: slots }, () => 0));
  const prevDone = useRef(0);

  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), [w, h]);
  const taupe = useMemo(() => new THREE.Color(TAUPE), []);

  useFrame(({ clock, viewport }, delta) => {
    const l = live.current;
    const g = group.current;
    if (!g) return;

    const t = l.reduced ? 0 : clock.elapsedTime;
    const dt = l.reduced ? 0 : Math.min(delta, 0.05);
    const done = clamp(l.done, 0, slots);
    const progress = l.total ? done / l.total : 0;

    // arrival pop
    if (done > prevDone.current) {
      for (let i = prevDone.current; i < done; i++) pop.current[i] = 1;
      prevDone.current = done;
    }

    // scene fit + cursor tilt
    g.scale.setScalar(clamp(viewport.width / 7.2, 0.6, 1.15));
    const tx = l.reduced ? 0 : l.ptr.x;
    const ty = l.reduced ? 0 : l.ptr.y;
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, tx * 0.3, 0.06);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, 0.28 - ty * 0.15, 0.06);

    // core: speeds up as results arrive
    if (spin.current) {
      spin.current.rotation.y += dt * (0.8 + progress * 1.6);
      spin.current.rotation.x += dt * 0.3;
    }
    if (seed.current) seed.current.scale.setScalar(0.4 + Math.sin(t * 3) * 0.04 + progress * 0.1);

    // pending slot that is "being worked on"
    const active = l.total ? Math.min(done, slots - 1) : Math.floor(t * 1.1) % slots;

    for (let i = 0; i < slots; i++) {
      const tile = tiles.current[i];
      const fill = fills.current[i];
      const edge = edgeMats.current[i];
      if (!tile || !fill || !edge) continue;

      pop.current[i] = Math.max(0, pop.current[i] - dt * 2.4);
      const p = pop.current[i];
      const isDone = i < done;

      const angle = (i / slots) * Math.PI * 2 + t * 0.28;
      tile.position.set(Math.cos(angle) * 2.05, Math.sin(angle * 2) * 0.1, Math.sin(angle) * 1.1);
      tile.rotation.y = -Math.cos(angle) * 0.35;
      tile.scale.setScalar(1 + p * p * 0.55);

      const target = isDone ? 0.92 : i === active ? 0.22 + (Math.sin(t * 6) * 0.5 + 0.5) * 0.2 : 0;
      fill.opacity += (target - fill.opacity) * Math.min(1, dt * 10 + (l.reduced ? 1 : 0));
      edge.color.copy(isDone ? accent : taupe);
    }
  });

  return (
    <group ref={group}>
      <group ref={spin}>
        <mesh>
          <icosahedronGeometry args={[0.55, 1]} />
          <meshStandardMaterial color={CHARCOAL} roughness={0.45} metalness={0.3} flatShading />
        </mesh>
        <mesh scale={1.06}>
          <icosahedronGeometry args={[0.55, 1]} />
          <meshBasicMaterial color={accent} wireframe transparent opacity={0.9} />
        </mesh>
        <mesh ref={seed} scale={0.4}>
          <icosahedronGeometry args={[0.55, 2]} />
          <meshBasicMaterial color={accent} />
        </mesh>
      </group>

      {Array.from({ length: slots }, (_, i) => (
        <group
          key={i}
          ref={el => {
            tiles.current[i] = el;
          }}
        >
          <mesh>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial
              ref={el => {
                fills.current[i] = el;
              }}
              color={accent}
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <lineSegments geometry={edges}>
            <lineBasicMaterial
              ref={el => {
                edgeMats.current[i] = el;
              }}
              color={TAUPE}
              transparent
              opacity={0.85}
            />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}

function readAccent(el: HTMLElement): THREE.Color {
  const color = new THREE.Color(FALLBACK_ACCENT);
  try {
    const raw = getComputedStyle(el).getPropertyValue('--client-primary').trim();
    if (raw && typeof CSS !== 'undefined' && CSS.supports('color', raw)) {
      color.setStyle(raw);
      // keep it readable on a light surface
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      if (hsl.l > 0.6) color.setHSL(hsl.h, hsl.s, 0.52);
    }
  } catch {
    /* keep fallback */
  }
  return color;
}

export default function CreateScene({ kind, total, done }: { kind: Kind; total: number; done: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const live = useRef<Live>({ done, total, reduced: false, ptr: { x: 0, y: 0 } });
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [accent, setAccent] = useState(() => new THREE.Color(FALLBACK_ACCENT));

  useEffect(() => {
    live.current.done = done;
    live.current.total = total;
  }, [done, total]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;

    try {
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
    } catch {
      return;
    }

    setAccent(readAccent(el));
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    live.current.reduced = mq.matches;
    setReduced(mq.matches);
    setReady(true);

    const onMotion = (e: MediaQueryListEvent) => {
      live.current.reduced = e.matches;
      setReduced(e.matches);
    };
    mq.addEventListener('change', onMotion);

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      live.current.ptr.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      live.current.ptr.y = clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1, 1);
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
    <div ref={wrap} className="create-scene" aria-hidden="true" data-ready={ready}>
      {ready && (
        <Canvas
          frameloop={reduced ? 'demand' : visible ? 'always' : 'never'}
          dpr={[1, 1.75]}
          camera={{ position: [0, 0.2, 5], fov: 38 }}
          gl={{ antialias: true, alpha: true }}
        >
          <ambientLight intensity={0.9} />
          <directionalLight position={[2, 3, 4]} intensity={1.1} />
          <Ring kind={kind} accent={accent} live={live} />
        </Canvas>
      )}
    </div>
  );
}
