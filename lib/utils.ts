export function normaliseUrl(v: string): string {
  v = String(v || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    u.hash = '';
    u.search = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
    u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString().replace(/\/$/, '');
  } catch { return ''; }
}
export function companyNameFromUrl(v: string): string {
  try {
    const host = new URL(normaliseUrl(v)).hostname.replace(/^www\./i, '');
    const label = host.split('.')[0].replace(/[-_]+/g, ' ').trim();
    return label ? label.replace(/\b\w/g, c => c.toUpperCase()) : 'Company';
  } catch { return 'Company'; }
}
export function companyInitials(name: string): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map(w => w[0]).join('') : words[0]?.slice(0, 2) || 'C').toUpperCase();
}
export function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function ymd(d: Date): string { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
export function fmtDate(d: Date): string { return d.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}); }
export function fmtTime(t: string): string { const [h,m]=t.split(':').map(Number); const d=new Date(); d.setHours(h,m); return d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}); }
export function htmlToText(h: string): string { if(typeof document==='undefined') return h.replace(/<[^>]+>/g,'').replace(/\n{3,}/g,'\n\n').trim(); const d=document.createElement('div'); d.innerHTML=h; return (d.textContent||'').replace(/\n{3,}/g,'\n\n').trim(); }
export async function copyText(text: string): Promise<void> { try{await navigator.clipboard.writeText(text)}catch{const t=document.createElement('textarea');t.value=text;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();} }
export function slug(n: string): string { return String(n||'content').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'content'; }
export function downloadFile(n: string,text: string,type: string): void { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=n; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500); }
export function shiftColor(hex: string,amt: number): string { if(typeof hex!=='string' || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(hex)) return '#888'; let value=hex.slice(1); if(value.length===3) value=value.split('').map(c=>c+c).join(''); const n=parseInt(value,16); if(Number.isNaN(n)) return '#888'; const r=Math.min(255,Math.max(0,(n>>16)+amt)); const g=Math.min(255,Math.max(0,((n>>8)&0xff)+amt)); const b=Math.min(255,Math.max(0,(n&0xff)+amt)); return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1); }
export function sanitizeHtml(h: string): string {
  const input = String(h || '');
  if (typeof document === 'undefined') {
    return input
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '')
      .replace(/<iframe\b[^>]*\/?\s*>/gi, '')
      .replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, '')
      .replace(/<embed\b[^>]*\/?\s*>/gi, '')
      .replace(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi, '')
      .replace(/<form\b[^>]*\/?\s*>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, '')
      .replace(/<math\b[^>]*>[\s\S]*?<\/math\s*>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+(?:srcdoc|style|xmlns(?::[^\s=]+)?)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/vbscript\s*:/gi, '')
      .replace(/data\s*:\s*text\/html/gi, '');
  }

  const template = document.createElement('template');
  template.innerHTML = input;
  template.content.querySelectorAll('script,iframe,object,embed,form,input,button,textarea,select,option,style,base,meta,link,svg,math,template').forEach((el) => el.remove());
  template.content.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'style' || name === 'xmlns' || name.startsWith('xmlns:')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href' || name === 'src') {
        if (!/^(?:https?:|mailto:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(value)) {
          el.removeAttribute(attr.name);
        }
      }
    }
    if (el.tagName.toLowerCase() === 'a' && el.getAttribute('target') === '_blank') {
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return template.innerHTML;
}
