'use client';
import { createContext, useContext, useCallback, useState, type ReactNode } from 'react';
const Ctx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(Ctx);
export function ToastProvider({ children }: { children: ReactNode }) { const [msg,setMsg]=useState(''); const [on,setOn]=useState(false); const toast=useCallback((m:string)=>{setMsg(m);setOn(true);setTimeout(()=>setOn(false),2800);},[]);
  return <Ctx.Provider value={toast}>{children}{on && <div className="toast">{msg}</div>}</Ctx.Provider>; }
