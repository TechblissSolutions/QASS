'use client';
import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { toast as ding } from '@yusufceng1z/ding-react';

// Same API as before: useToast() returns a function that takes a message string.
// Messages now show with the Ding toast (rendered by <DingToaster /> in app/layout.tsx).
const Ctx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

const ERROR_RE = /unable|failed|could not|couldn't|cannot|can't|error|not configured|not connected|denied|invalid/i;
const INFO_RE = /^please\b|started|stopped|cancelled|canceled|monitoring|retry/i;

export function ToastProvider({ children }: { children: ReactNode }) {
  const toast = useCallback((m: string) => {
    if (!m) return;
    if (ERROR_RE.test(m)) ding.error(m);
    else if (INFO_RE.test(m)) ding.info(m);
    else ding.success(m);
  }, []);
  return <Ctx.Provider value={toast}>{children}</Ctx.Provider>;
}
