import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join('/tmp', process.env.JOB_LOG_DIR || 'job-logs');

// Ensure log directory exists
export function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

// Get log file path for a job
export function getLogPath(jobId: string): string {
  return path.join(LOG_DIR, `${jobId}.jsonl`);
}

// Append an event to the job log
export function appendToLog(jobId: string, event: {
  seq: number;
  kind: string;
  payload: any;
  created_at: string;
}): void {
  ensureLogDir();
  const logPath = getLogPath(jobId);
  const line = JSON.stringify(event) + '\n';
  fs.appendFileSync(logPath, line, { flag: 'a' });
}

// Read all events from the job log since a given seq
export function readLogSince(jobId: string, sinceSeq: number = 0): Array<{
  seq: number;
  kind: string;
  payload: any;
  created_at: string;
}> {
  const logPath = getLogPath(jobId);
  if (!fs.existsSync(logPath)) {
    return [];
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const events: Array<{ seq: number; kind: string; payload: any; created_at: string }> = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.seq > sinceSeq) {
        events.push(event);
      }
    } catch {
      // Skip invalid lines
    }
  }

  return events;
}

// Truncate log after a given seq (for resume semantics)
export function truncateLogAfterSeq(jobId: string, seq: number): void {
  const logPath = getLogPath(jobId);
  if (!fs.existsSync(logPath)) {
    return;
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const keptLines: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.seq <= seq) {
        keptLines.push(line);
      }
    } catch {
      // Skip invalid lines
    }
  }

  fs.writeFileSync(logPath, keptLines.join('\n') + (keptLines.length > 0 ? '\n' : ''));
}

// Delete log file for a job
export function deleteLog(jobId: string): void {
  const logPath = getLogPath(jobId);
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
  }
}

// Watch log file for new events (returns an async generator)
export async function* watchLog(
  jobId: string,
  sinceSeq: number = 0,
  pollIntervalMs: number = 100
): AsyncGenerator<{ seq: number; kind: string; payload: any; created_at: string }> {
  const logPath = getLogPath(jobId);
  let lastSeq = sinceSeq;
  let lastSize = 0;

  // First, yield any existing events
  const existingEvents = readLogSince(jobId, sinceSeq);
  for (const event of existingEvents) {
    yield event;
    lastSeq = event.seq;
  }

  // Get initial file size
  if (fs.existsSync(logPath)) {
    lastSize = fs.statSync(logPath).size;
  }

  // Then poll for new events
  while (true) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    if (!fs.existsSync(logPath)) {
      continue;
    }

    const stat = fs.statSync(logPath);
    if (stat.size === lastSize) {
      continue;
    }

    const newEvents = readLogSince(jobId, lastSeq);
    for (const event of newEvents) {
      yield event;
      lastSeq = event.seq;
    }
    lastSize = stat.size;
  }
}
