import { Fragment } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import styles from './FreeTrial.module.css';

/**
 * Shows a generated draft in the format it will actually be published in:
 *  - LinkedIn: a post card (avatar, name, paragraphs, highlighted hashtags, action row)
 *  - Blog: an article (title, reading time, headings, lists, quotes)
 * Everything is rendered as React elements (no HTML injection). The raw text is untouched, so Copy still copies it as is.
 */
type ListBlock = { t: 'ul'; items: string[] } | { t: 'ol'; items: string[] };
type Block = { t: 'h'; l: number; x: string } | { t: 'p'; x: string } | { t: 'q'; x: string } | { t: 'hr' } | ListBlock;

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\))/g;

function tags(part: string, key: number): ReactNode {
  return <Fragment key={key}>{part.split(/(#[\p{L}\p{N}_]+)/u).map((s, j) => (s.length > 1 && s.startsWith('#') ? <span key={j} className={styles.tag}>{s}</span> : s))}</Fragment>;
}

function inline(text: string, hashtags = false): ReactNode[] {
  return text.split(INLINE).filter(part => part !== '').map((part, i) => {
    let m: RegExpExecArray | null;
    if ((m = /^\*\*([^*]+)\*\*$/.exec(part)) || (m = /^__([^_]+)__$/.exec(part))) return <strong key={i}>{inline(m[1], hashtags)}</strong>;
    if ((m = /^`([^`]+)`$/.exec(part))) return <code key={i}>{m[1]}</code>;
    if ((m = /^\*([^*]+)\*$/.exec(part))) return <em key={i}>{inline(m[1], hashtags)}</em>;
    if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part))) {
      return /^https?:\/\//i.test(m[2]) ? <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a> : <span key={i}>{m[1]}</span>;
    }
    return hashtags ? tags(part, i) : part;
  });
}

function parse(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list = null as ListBlock | null;
  const flush = () => {
    if (para.length) out.push({ t: 'p', x: para.join('\n') });
    if (quote.length) out.push({ t: 'q', x: quote.join('\n') });
    if (list) out.push(list);
    para = []; quote = []; list = null;
  };
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) { flush(); continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); out.push({ t: 'h', l: m[1].length, x: m[2] }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ t: 'hr' }); continue; }
    if ((m = /^\s*>\s?(.*)$/.exec(line))) { if (!quote.length) flush(); quote.push(m[1]); continue; }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      if (!list || list.t !== 'ul') { flush(); list = { t: 'ul', items: [] }; }
      list.items.push(m[1]); continue;
    }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      if (!list || list.t !== 'ol') { flush(); list = { t: 'ol', items: [] }; }
      list.items.push(m[1]); continue;
    }
    if (list || quote.length) flush();
    para.push(line);
  }
  flush();
  return out;
}

export function draftStats(text: string, type: 'linkedin' | 'blog') {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { words, chars: text.length, minutes: Math.max(1, Math.round(words / 200)), label: type === 'blog' ? `${Math.max(1, Math.round(words / 200))} min read` : `${text.length.toLocaleString()} characters` };
}

const Ico = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

export default function DraftPreview({ type, text, company, animate }: { type: 'linkedin' | 'blog'; text: string; company: string; animate: boolean }) {
  const blocks = parse(text);
  const blk = (i: number) => ({ className: animate ? styles.blkIn : undefined, style: { '--i': i } as CSSProperties });
  const stats = draftStats(text, type);

  if (type === 'linkedin') {
    const name = company.trim() || 'Your brand';
    return (
      <div className={styles.draftStage}>
        <article className={styles.liCard} aria-label="LinkedIn post preview">
          <header className={styles.liHead}>
            <span className={styles.liAv} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
            <div><strong>{name}</strong><small>Just now · Public</small></div>
          </header>
          <div className={styles.liBody}>
            {blocks.map((b, i) => {
              switch (b.t) {
                case 'h':
                  return <p key={i} {...blk(i)}>{inline(`**${b.x}**`, true)}</p>;
                case 'p':
                case 'q':
                  return <p key={i} {...blk(i)}>{inline(b.x, true)}</p>;
                case 'ul':
                  return <ul key={i} {...blk(i)}>{b.items.map((it, j) => <li key={j}>{inline(it, true)}</li>)}</ul>;
                case 'ol':
                  return <ol key={i} {...blk(i)}>{b.items.map((it, j) => <li key={j}>{inline(it, true)}</li>)}</ol>;
                case 'hr':
                  return <hr key={i} {...blk(i)} />;
              }
            })}
          </div>
          <footer className={styles.liActions} aria-hidden="true">
            <span><Ico><path d="M7 10v10H3V10zM7 10l4-7c1.7 0 2.7 1.2 2.3 2.8L12.6 9H19c1.3 0 2.200 1.100 2 2.300l-1.300 7c-.2 1-1 1.700-2 1.700H7" /></Ico>Like</span>
            <span><Ico><path d="M4 5.5h16v11H10l-5 4v-4H4z" /></Ico>Comment</span>
            <span><Ico><path d="M4 11V8a3 3 0 0 1 3-3h10l-3-3M20 13v3a3 3 0 0 1-3 3H7l3 3" /></Ico>Repost</span>
            <span><Ico><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" /></Ico>Send</span>
          </footer>
        </article>
      </div>
    );
  }

  let titled = false;
  return (
    <article className={styles.article} aria-label="Blog draft preview">
      <div className={styles.artMeta}><span>Blog draft</span><span>{stats.label}</span></div>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h':
            if (b.l === 1 && !titled) { titled = true; return <h3 key={i} {...blk(i)} className={`${styles.artTitle}${animate ? ` ${styles.blkIn}` : ''}`}>{inline(b.x)}</h3>; }
            return b.l <= 2 ? <h4 key={i} {...blk(i)} className={`${styles.artH2}${animate ? ` ${styles.blkIn}` : ''}`}>{inline(b.x)}</h4> : <h5 key={i} {...blk(i)} className={`${styles.artH3}${animate ? ` ${styles.blkIn}` : ''}`}>{inline(b.x)}</h5>;
          case 'p':
            return <p key={i} {...blk(i)}>{inline(b.x)}</p>;
          case 'q':
            return <blockquote key={i} {...blk(i)}>{inline(b.x)}</blockquote>;
          case 'ul':
            return <ul key={i} {...blk(i)}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
          case 'ol':
            return <ol key={i} {...blk(i)}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
          case 'hr':
            return <hr key={i} {...blk(i)} />;
        }
      })}
    </article>
  );
}
