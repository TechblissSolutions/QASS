'use client';

import './signal-reveal-text.css';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ElementType } from 'react';

type Props = {
  text: string;
  as?: ElementType;
  className?: string;
  /** ms before the first word starts */
  delay?: number;
  /** ms for one word to arrive (650 to 1800) */
  speed?: number;
  /** loop forever (for waiting states). Default: play once and stay */
  loop?: boolean;
  /** 'load' plays right away, 'view' waits until the text scrolls into view */
  trigger?: 'load' | 'view';
};

/**
 * Words arrive one after another: fade up, soft blur clearing.
 * Plain CSS animation, no libraries. Text stays readable for screen readers and with reduced motion.
 */
export default function SignalRevealText({
  text, as: Tag = 'span', className, delay = 0, speed = 1050, loop = false, trigger = 'load',
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (trigger !== 'view') return;
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [trigger]);

  const words = text.trim().split(/\s+/);
  const dur = Math.min(Math.max(speed, 650), 1800);
  const stagger = words.length > 1 ? Math.min(80, 480 / (words.length - 1)) : 0;
  const cls = ['sr-text', loop ? 'is-loop' : '', trigger === 'view' ? 'is-wait' : '', seen ? 'is-in' : '', className ?? '']
    .filter(Boolean).join(' ');

  return (
    <Tag ref={ref} className={cls} aria-label={text}
      style={{ '--sr-dur': `${dur}ms`, '--sr-loop': `${Math.round(dur * 3.1)}ms` } as CSSProperties}>
      <span className="sr-copy" aria-hidden="true">
        {words.map((w, i) => (
          <Fragment key={`${w}-${i}`}>
            <span className="sr-word" style={{ '--sr-delay': `${Math.max(delay, 0) + i * stagger}ms` } as CSSProperties}>{w}</span>
            {i < words.length - 1 ? ' ' : null}
          </Fragment>
        ))}
      </span>
    </Tag>
  );
}
