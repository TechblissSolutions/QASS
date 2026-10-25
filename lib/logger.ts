import 'server-only';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  route: string;
  request_id: string;
  user_id?: string;
  project_id?: string;
  job_id?: string;
  duration_ms?: number;
  status?: number;
  error?: string;
  [key: string]: unknown;
}

export function log(entry: LogEntry) {
  const out = { ts: new Date().toISOString(), ...entry };
  if (entry.level === 'error') console.error(JSON.stringify(out));
  else if (entry.level === 'warn') console.warn(JSON.stringify(out));
  else console.log(JSON.stringify(out));
}

export function requestId() {
  return crypto.randomUUID();
}
