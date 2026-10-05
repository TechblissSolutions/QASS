'use client';
import type { Piece, ScheduleEntry } from '@/lib/types';
import { fmtDate, fmtTime, copyText } from '@/lib/utils';
import { useToast } from './Toast';
import Chip from './Chip';
export default function ContentCard({ piece:p, schedule:w, onOpen, onSchedule }: { piece:Piece; schedule?:ScheduleEntry; onOpen:(id:string)=>void; onSchedule:(id:string)=>void; }) {
  const toast = useToast();
  return <article className="sq" tabIndex={0} onClick={()=>onOpen(p.id)}>
    <div className="sq-top"><Chip channel={p.channel}/><span className="fmt">{p.format||p.section}</span></div>
    <h3>{p.title}</h3><p>{p.bodyText.slice(0,120)}</p>
    <div className="sq-foot">{w?<span className="sched-badge">{fmtDate(new Date(w.date+'T00:00'))}, {fmtTime(w.time)}</span>:<span className="sq-meta">{p.wordCount} words</span>}
      <span style={{display:'flex',gap:6}}><button className="btn btn-ghost btn-sm btn-icon" aria-label="Copy" onClick={e=>{e.stopPropagation();copyText(p.title+'\n\n'+p.bodyText).then(()=>toast('Copied'))}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg></button><button className="btn btn-primary btn-sm" onClick={e=>{e.stopPropagation();onSchedule(p.id)}}>{w?'Move':'Schedule'}</button></span>
    </div>
  </article>;
}
