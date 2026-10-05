import type { Piece, ScheduleEntry } from './types';
import { ymd, downloadFile, slug } from './utils';
type Item = { p: Piece; w: ScheduleEntry };
export function exportIcs(list: Item[], name: string) {
  const fold=(l:string)=>{const o:string[]=[];while(l.length>74){o.push(l.slice(0,74));l=' '+l.slice(74);}o.push(l);return o.join('\r\n');};
  const ic=(v:string)=>String(v).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Sparrow//Content Agent//EN','CALSCALE:GREGORIAN'];
  list.forEach(({p,w})=>{const[h,mi]=w.time.split(':').map(Number);const st=w.date.replace(/-/g,'')+'T'+String(h).padStart(2,'0')+String(mi).padStart(2,'0')+'00';const end=new Date(w.date+'T'+w.time);end.setMinutes(end.getMinutes()+30);const et=ymd(end).replace(/-/g,'')+'T'+String(end.getHours()).padStart(2,'0')+String(end.getMinutes()).padStart(2,'0')+'00';lines.push('BEGIN:VEVENT','UID:'+p.id+'-'+w.date+'@tb-agent','DTSTAMP:'+stamp,'DTSTART:'+st,'DTEND:'+et,fold('SUMMARY:'+ic('['+p.channel+'] '+p.title)),fold('DESCRIPTION:'+ic(p.bodyText.slice(0,800))),'END:VEVENT');});
  lines.push('END:VCALENDAR');downloadFile(slug(name)+'-calendar.ics',lines.join('\r\n'),'text/calendar');
}
export function exportCsv(list: Item[], name: string) {
  const c=(v:unknown)=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const rows=[['Date','Time','Channel','Format','Title','Content'].map(c).join(',')];
  list.forEach(({p,w})=>rows.push([w.date,w.time,p.channel,p.format,p.title,p.bodyText.slice(0,500)].map(c).join(',')));
  downloadFile(slug(name)+'-calendar.csv','\ufeff'+rows.join('\r\n'),'text/csv');
}
