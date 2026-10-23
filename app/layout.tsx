import SentryErrorBoundary from '@/components/SentryErrorBoundary';
import type { Metadata } from 'next';
import { StoreProvider } from '@/lib/store';
import { ToastProvider } from '@/components/Toast';
import './globals.css';
import './premium.css';
export const metadata: Metadata = { title: 'Sparrow by TechBliss - Your brand, in motion.', description: 'Turn the story behind your business into content your team can review, refine, and ship.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-scroll-behavior="smooth"><body><StoreProvider><SentryErrorBoundary><ToastProvider>
    <div className="app-layout"><main>{children}</main></div>
  </ToastProvider></SentryErrorBoundary></StoreProvider></body></html>;
}
