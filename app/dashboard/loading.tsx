import TunnelLoader from '@/components/TunnelLoader';

// Without this, history pages would inherit the dashboard's "Loading your companies" text.
export default function Loading() {
  return <TunnelLoader title="Loading history" />;
}
