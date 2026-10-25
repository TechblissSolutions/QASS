'use client';

import { getAccessToken } from './auth';

export async function persistJobState(projectId: string, jobRowId: string, patch: Record<string, unknown>): Promise<boolean> {
  try {
    const token = await getAccessToken();
    if (!token) return false;
    const res = await fetch('/api/jobs/persist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ project_id: projectId, job_row_id: jobRowId, ...patch }),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}
