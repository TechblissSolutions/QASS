'use client';

/**
 * Types its text out character by character, but ONLY when the card appears while a
 * generation is in progress (the Studio generation strip is on screen). Older content,
 * page loads and reduced-motion users always see the full text straight away.
 * Layout never jumps: the not-yet-typed remainder is rendered invisibly.
 */

import { useEffect, useLayoutEffect, useState } from 'react';

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default function TypeText({ text, cps = 90 }: { text: string; cps?: number }) {
  const [n, setN] = useState(text.length);

  useIsoLayoutEffect(() => {
    const generating = !!document.querySelector('.studio-generation-strip');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!generating || reduced || !text) return;
    setN(0);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const c = Math.min(text.length, Math.floor(((now - t0) / 1000) * cps));
      setN(c);
      if (c < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (n >= text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, n)}
      <span className="mx-caret" aria-hidden="true" />
      <span style={{ visibility: 'hidden' }}>{text.slice(n)}</span>
    </>
  );
}
