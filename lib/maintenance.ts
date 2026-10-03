import { createClient } from '@vercel/edge-config';

export async function edgeMaintenanceEnabled() {
  const connection = process.env.EDGE_CONFIG;
  if (!connection) return false;
  try {
    const config = createClient(connection);
    return Boolean(await config.get('maintenance_mode'));
  } catch {
    return false;
  }
}
