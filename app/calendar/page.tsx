'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { getAccessToken } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { ymd, fmtTime, startOfMonth } from '@/lib/utils';
import TimePicker from '@/components/TimePicker';
import BrandTheme from '@/components/BrandTheme';
import StoreLoading from '@/components/StoreLoading';
import CompanyHeader from '@/components/CompanyHeader';

export default function CalendarPage() {
  const {s,set,piece,ready} = useStore();
  const router = useRouter();
  const toast = useToast();
  const [month,setMonth] = useState(()=>startOfMonth(new Date()));
  const [schedId,setSchedId] = useState<string|null>(null);
  const [schedDate,setSchedDate] = useState('');
  const [schedTime,setSchedTime] = useState('10:00');
  const dragRef = useRef<string|null>(null);

  useEffect(()=>{
    if(!ready) return;
    void (async()=>{
      const token=await getAccessToken();
      if(!token){router.replace('/login?redirect='+encodeURIComponent(window.location.pathname+window.location.search));return;}
      const projectId=new URLSearchParams(window.location.search).get('project');
      if(projectId && projectId!==s.projectId) router.replace(`/studio?project=${encodeURIComponent(projectId)}`);
    })();
  },[ready,s.projectId,router]);

  if(!ready) return <StoreLoading/>;
  if(!s.projectId || !s.profile) return null;

  const today=ymd(new Date());
  const offset=(new Date(month).getDay()+6)%7;
  const start=new Date(month.getFullYear(),month.getMonth(),1-offset);
  const byDay:Record<string,{id:string;date:string;time:string;channel:string}[]>={};

  Object.entries(s.schedule).forEach(([id,w])=>{
    if (id === '__selectedPlatforms' || !w || typeof w !== 'object' || !('date' in w)) return;
    const p=piece(id);
    if(!p) return;
    (byDay[w.date] ||= []).push({id,date:w.date,time:w.time,channel:p.channel});
  });
  Object.values(byDay).forEach(list=>list.sort((a,b)=>a.time.localeCompare(b.time)));

  const openSchedule=(id:string,date?:string)=>{
    const w=s.schedule[id];
    if(!w) return;
    setSchedId(id);
    setSchedDate(date || w.date);
    setSchedTime(w.time || '10:00');
  };

  const saveSchedule=(date:string,time:string)=>{
    if(!schedId) return;
    const next={...s.schedule,[schedId]:{date,time}};
    set({schedule:next});
    setSchedId(null);
    toast('Post moved');
  };

  const removeSchedule=()=>{
    if(!schedId) return;
    const next={...s.schedule};
    delete next[schedId];
    set({schedule:next});
    setSchedId(null);
    toast('Scheduled post cancelled');
  };

  const dayDrop=(date:string)=>{
    const id=dragRef.current;
    dragRef.current=null;
    if(!id || date<today) return;
    const current=s.schedule[id];
    set({schedule:{...s.schedule,[id]:{date,time:current?.time||'10:00'}}});
    toast('Post moved');
  };

  const days=Array.from({length:42},(_,i)=>{
    const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i);
    const key=ymd(d);
    return {d,key,out:d.getMonth()!==month.getMonth(),today:key===today,past:key<today};
  });

  return <div className="company-workspace">
    <CompanyHeader/><BrandTheme/>
    <div className="page-container calendar-only-page">
      <div className="page-head">
        <div><span className="calendar-kicker">CONTENT CALENDAR</span><h1>Calendar</h1><p>Move a scheduled post to another date or cancel it.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={()=>router.push(`/studio?project=${encodeURIComponent(s.projectId||'')}`)}>Back to Studio</button>
      </div>

      <section className="calendar-shell">
        <div className="calendar-toolbar">
          <div className="calendar-month-nav">
            <button className="btn btn-ghost btn-icon" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))} aria-label="Previous month">‹</button>
            <h2>{month.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h2>
            <button className="btn btn-ghost btn-icon" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))} aria-label="Next month">›</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>setMonth(startOfMonth(new Date()))}>Today</button>
          </div>
          <div className="calendar-toolbar-note">{Object.keys(s.schedule).filter(key => key !== '__selectedPlatforms').length} scheduled</div>
        </div>

        <div className="calendar-month">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><div key={d} className="calendar-dow">{d}</div>)}
          {days.map(({d,key,out,today:isToday,past})=>{
            const events=byDay[key]||[];
            return <div key={key}
              className={'calendar-day'+(out?' is-out':'')+(isToday?' is-today':'')+(past?' is-past':'')}
              onDragOver={e=>{if(!past)e.preventDefault()}}
              onDrop={()=>dayDrop(key)}
            >
              <span className="calendar-day-number">{d.getDate()}</span>
              <div className="calendar-events">
                {events.slice(0,4).map(ev=><button key={ev.id} className="calendar-event"
                  draggable
                  onDragStart={()=>{dragRef.current=ev.id}}
                  onClick={()=>openSchedule(ev.id)}
                  title="Move or cancel this post"
                >
                  <span className="calendar-event-dot" />
                  <span>{ev.channel}</span>
                  <time>{fmtTime(ev.time)}</time>
                </button>)}
                {events.length>4&&<span className="calendar-more">+{events.length-4} more</span>}
              </div>
            </div>;
          })}
        </div>
      </section>

      {schedId&&piece(schedId)&&<TimePicker
        piece={piece(schedId)!}
        initDate={schedDate}
        initTime={schedTime}
        hasExisting
        onSave={saveSchedule}
        onRemove={removeSchedule}
        onClose={()=>setSchedId(null)}
      />}
    </div>
  </div>;
}
