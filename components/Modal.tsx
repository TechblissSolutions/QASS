'use client';
import { useEffect, type ReactNode } from 'react';
export default function Modal({ open, onClose, small, children }: { open: boolean; onClose: ()=>void; small?: boolean; children: ReactNode }) {
  useEffect(()=>{if(!open)return;const h=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};document.addEventListener('keydown',h);return()=>document.removeEventListener('keydown',h)},[open,onClose]);
  if(!open) return null;
  return <div className="scrim" onClick={e=>{if((e.target as HTMLElement).classList.contains('scrim'))onClose()}}><div className={'modal '+(small?'small':'')} role="dialog" aria-modal="true">{children}</div></div>;
}
