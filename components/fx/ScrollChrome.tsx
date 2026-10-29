'use client';

import { useEffect } from 'react';

/**
 * Sets data-scrolled on <html> once the page is scrolled a little.
 * The floating header bars use it to change from glass to solid white.
 * Only toggles one attribute; no state, no markup, no logic.
 */
export default function ScrollChrome() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    let nestedScrollTop = 0;
    const update = () => {
      raf = 0;
      const pageScrollTop = Math.max(window.scrollY, root.scrollTop, document.body.scrollTop);
      if (Math.max(pageScrollTop, nestedScrollTop) > 24) root.setAttribute('data-scrolled', '');
      else root.removeAttribute('data-scrolled');
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      nestedScrollTop = target instanceof HTMLElement && target !== document.documentElement && target !== document.body && target.scrollHeight > target.clientHeight
        ? target.scrollTop
        : 0;
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, true);
      if (raf) cancelAnimationFrame(raf);
      root.removeAttribute('data-scrolled');
    };
  }, []);
  return null;
}
