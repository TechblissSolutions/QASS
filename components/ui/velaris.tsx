"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/* Velaris — animated simplex-noise gradient (WebGL).
   Adapted for this project: no Tailwind / `cn` dependency (inline styles),
   plus `vignette`, `opacity`, `maxDpr`, reduced-motion support and
   safe fallbacks when WebGL or shader compilation is unavailable. */

const vertexShaderGLSL = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShaderGLSL = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;

uniform vec2  u_resolution;
uniform float u_time;
uniform float u_grain;
uniform float u_vignette;
uniform float u_scale;
uniform vec3  u_colors[4];
uniform vec3  u_bg;

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
  + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
    dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 uv = vUv;
  float ratio = u_resolution.x / u_resolution.y;
  vec2 p = uv - 0.5;
  p.x *= ratio;

  float t = u_time * 0.1;

  // u_scale = noise frequency: 1 = original (one huge, slow blob), 3+ = clearly visible shapes
  vec2 q = p * u_scale;
  float n1 = snoise(q * 0.4 + vec2(t * 0.2, -t * 0.3));
  float n2 = snoise(q * 0.55 + vec2(-t * 0.15, t * 0.25) + n1 * 0.25);
  float n3 = snoise(q * 0.75 + vec2(t * 0.1, -t * 0.2) + n2 * 0.2);

  vec3 col = u_bg;

  float dist = length(p) * 1.5;
  float vignette = 1.0 - smoothstep(0.3, 1.2, dist);

  col = mix(col, u_colors[0], smoothstep(-0.2, 0.5, n1) * 0.85);
  col = mix(col, u_colors[1], smoothstep(-0.1, 0.6, n2) * 0.7);
  col = mix(col, u_colors[2], smoothstep(-0.3, 0.4, n3) * 0.6);
  col = mix(col, u_colors[3], smoothstep(0.0, 0.7, n1 * n2) * 0.5);

  float glow = smoothstep(0.8, 0.0, dist) * 0.3;
  col += u_colors[1] * glow;

  // u_vignette = 1 -> original dark edges, 0 -> no darkening (light themes)
  col = mix(col * (1.0 - 0.8 * u_vignette), col, vignette);

  float grain = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453 + u_time);
  col += (grain - 0.5) * u_grain * 0.1;

  gl_FragColor = vec4(col, 1.0);
}
`;

export interface VelarisProps {
  bg?: string;
  colors?: string[];
  speed?: number;
  grain?: number;
  /** 1 = original dark edge vignette, 0 = none (use 0 on light backgrounds) */
  vignette?: number;
  /** noise frequency. 1 = original; higher = more, smaller, more visible shapes */
  scale?: number;
  /** stop rendering (keeps the GL context alive) — e.g. when the backdrop is hidden */
  paused?: boolean;
  /** canvas opacity, 0–1 */
  opacity?: number;
  /** cap on devicePixelRatio; lower = cheaper on big/hi-dpi screens */
  maxDpr?: number;
  height?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const DEFAULT_COLORS = ["#86efac", "#4ade80", "#059669", "#000000"];

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

const Velaris = ({
  bg = "#000000",
  colors = DEFAULT_COLORS,
  speed = 2.0,
  grain = 0.3,
  vignette = 1,
  scale = 1,
  paused = false,
  opacity = 1,
  maxDpr = 2,
  height = "100vh",
  className,
  style,
  children,
}: VelarisProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(paused);
  const wakeRef = useRef<(() => void) | null>(null);
  const colorsKey = colors.join(",");

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = false;
    let lastT = 1500;
    let teardownGL: (() => void) | null = null;
    let draw: (t: number) => void = () => {};

    // Builds the GL program. Called again if the browser restores a lost context.
    const setup = (): (() => void) | null => {
      const gl = canvas.getContext("webgl", { antialias: false, powerPreference: "low-power" });
      if (!gl) return null;

      const createShader = (type: number, src: string) => {
        const sh = gl.createShader(type);
        if (!sh) return null;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.warn("Velaris shader error:", gl.getShaderInfoLog(sh));
          gl.deleteShader(sh);
          return null;
        }
        return sh;
      };

      const vs = createShader(gl.VERTEX_SHADER, vertexShaderGLSL);
      const fs = createShader(gl.FRAGMENT_SHADER, fragmentShaderGLSL);
      const program = gl.createProgram();
      if (!vs || !fs || !program) return null;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn("Velaris link error:", gl.getProgramInfoLog(program));
        return null;
      }
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

      const pos = gl.getAttribLocation(program, "position");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

      const locs = {
        res: gl.getUniformLocation(program, "u_resolution"),
        time: gl.getUniformLocation(program, "u_time"),
        grain: gl.getUniformLocation(program, "u_grain"),
        vignette: gl.getUniformLocation(program, "u_vignette"),
        scale: gl.getUniformLocation(program, "u_scale"),
        colors: gl.getUniformLocation(program, "u_colors"),
        bg: gl.getUniformLocation(program, "u_bg"),
      };

      // constants for this effect run — uploaded once instead of every frame
      gl.uniform1f(locs.grain, grain);
      gl.uniform1f(locs.vignette, vignette);
      gl.uniform1f(locs.scale, scale);
      gl.uniform3f(locs.bg, ...hexToRgb(bg));
      gl.uniform3fv(locs.colors, new Float32Array(colors.slice(0, 4).flatMap(hexToRgb)));

      draw = (t: number) => {
        lastT = t;
        gl.uniform2f(locs.res, canvas.width, canvas.height);
        gl.uniform1f(locs.time, t * 0.001 * speed);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };

      // NOTE: deliberately no WEBGL_lose_context here. It permanently kills the
      // canvas context, which breaks React StrictMode's mount → unmount → mount.
      return () => {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      };
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      canvas.width = Math.max(1, Math.floor(container.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(container.clientHeight * dpr));
      const gl = canvas.getContext("webgl");
      gl?.viewport(0, 0, canvas.width, canvas.height);
      if (!running) draw(lastT); // paused / reduced motion: keep a valid frame on screen
    };

    const loop = (t: number) => {
      if (pausedRef.current) {
        running = false;
        return;
      }
      draw(t);
      raf = requestAnimationFrame(loop);
    };

    const wake = () => {
      if (running || reduceMotion || pausedRef.current || !teardownGL) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };

    const onLost = (e: Event) => {
      e.preventDefault();
      running = false;
      cancelAnimationFrame(raf);
    };
    const onRestored = () => {
      teardownGL = setup();
      resize();
      wake();
    };

    teardownGL = setup();
    if (!teardownGL) return;
    wakeRef.current = wake;
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    if (reduceMotion) draw(lastT);
    else wake();

    return () => {
      wakeRef.current = null;
      ro.disconnect();
      cancelAnimationFrame(raf);
      running = false;
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      teardownGL?.();
    };
    // colorsKey stands in for `colors` so inline arrays don't recreate the GL context
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bg, colorsKey, speed, grain, vignette, scale, maxDpr]);

  // pause / resume without rebuilding the GL context
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) wakeRef.current?.();
  }, [paused]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", width: "100%", overflow: "hidden", height, ...style }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
          opacity,
        }}
      />
      {children ? (
        <div style={{ position: "relative", zIndex: 10, height: "100%", width: "100%" }}>{children}</div>
      ) : null}
    </div>
  );
};

export default Velaris;
