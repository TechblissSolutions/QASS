import { NextResponse, type NextRequest } from 'next/server';
import { edgeMaintenanceEnabled } from './lib/maintenance';

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/') || req.nextUrl.pathname === '/maintenance') return NextResponse.next();
  const envMaintenance = String(process.env.MAINTENANCE_MODE || 'false').toLowerCase() === 'true';
  const edgeMaintenance = await edgeMaintenanceEnabled();
  if (envMaintenance || edgeMaintenance) {
    const url = req.nextUrl.clone();
    url.pathname = '/maintenance';
    return NextResponse.rewrite(url);
  }

  // Auth is intentionally resolved by the Supabase browser session + the
  // protected API routes. A browser-only Supabase client stores its session in
  // local/sessionStorage, which an Edge middleware cannot read. Redirecting
  // here based on guessed cookie names caused valid users to be bounced back
  // to Login when opening a company. Private data is still server-authorized
  // by the API routes and Supabase RLS.
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
