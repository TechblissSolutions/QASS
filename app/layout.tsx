import SentryErrorBoundary from '@/components/SentryErrorBoundary';
import type { Metadata } from 'next';
import { StoreProvider } from '@/lib/store';
import { ToastProvider } from '@/components/Toast';
import AmbientBackdrop from '@/components/ambient/AmbientBackdrop';
import FuturisticFX from '@/components/fx/FuturisticFX';
import ScrollChrome from '@/components/fx/ScrollChrome';
import LiquidClick from '@/components/LiquidClick';
import AuroraBackdrop from '@/components/fx/AuroraBackdrop';
import './globals.css';
import './premium.css';
import './ambient-motion.css';
import './futuristic.css';
import './motion-system.css';
import './reference-app.css';
export const metadata: Metadata = { title: 'Sparrow by TechBliss - Your brand, in motion.', description: 'Turn the story behind your business into content your team can review, refine, and ship.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-scroll-behavior="smooth"><body><AuroraBackdrop /><AmbientBackdrop /><FuturisticFX /><ScrollChrome /><LiquidClick /><StoreProvider><SentryErrorBoundary><ToastProvider>
    <div className="app-layout"><main>{children}</main></div>
  </ToastProvider></SentryErrorBoundary></StoreProvider></body></html>;
}
