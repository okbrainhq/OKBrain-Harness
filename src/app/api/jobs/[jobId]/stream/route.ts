import { NextRequest } from 'next/server';
import { getJob, getJobHistory } from '@/lib/jobs';
import { getSession } from '@/lib/auth';

// GET /api/jobs/:jobId/stream - Stream job events via SSE
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { jobId } = await params;
  const { searchParams } = new URL(request.url);
  const sinceSeq = parseInt(searchParams.get('since_seq') || '0', 10);

  const job = await getJob(jobId);
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Validate ownership: if job has a user_id, only the owner can stream it
  if (job.user_id && job.user_id !== session.userId) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;

      const safeEnqueue = (data: string) => {
        if (!isClosed) {
          try {
            controller.enqueue(encoder.encode(data));
          } catch (error: any) {
            // Client disconnected - silently mark as closed
            isClosed = true;
          }
        }
      };

      const safeClose = () => {
        if (!isClosed) {
          isClosed = true;
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      };

      // First, send any existing events from DB
      const existingEvents = await getJobHistory(jobId, sinceSeq);
      for (const event of existingEvents) {
        const data = JSON.stringify({
          ...event,
          payload: (() => { try { return JSON.parse(event.payload); } catch { return event.payload; } })()
        });
        safeEnqueue(`data: ${data}\n\n`);
      }

      // Check if job is already in a terminal state - close immediately
      // Note: 'idle' is NOT terminal - job might be queued but not yet claimed by worker
      const currentJob = await getJob(jobId);
      if (!currentJob || currentJob.state === 'succeeded' || currentJob.state === 'failed' || currentJob.state === 'stopped') {
        safeEnqueue(`data: ${JSON.stringify({ done: true, state: currentJob?.state || 'unknown' })}\n\n`);
        safeClose();
        return;
      }

      // Watch for new events and periodically check job state
      const lastSeq = existingEvents.length > 0
        ? existingEvents[existingEvents.length - 1].seq
        : sinceSeq;

      try {
        let currentSeq = lastSeq;
        const POLL_INTERVAL = 100;
        const MAX_IDLE_CHECKS = 600; // 60 seconds max (600 * 100ms)
        let idleChecks = 0;

        while (idleChecks < MAX_IDLE_CHECKS && !isClosed) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

          // Check job state
          const updatedJob = await getJob(jobId);
          if (!updatedJob || updatedJob.state === 'succeeded' || updatedJob.state === 'failed' || updatedJob.state === 'stopped') {
            // Send any remaining events from DB before closing
            const finalEvents = await getJobHistory(jobId, currentSeq);
            for (const event of finalEvents) {
              const data = JSON.stringify({
                ...event,
                payload: (() => { try { return JSON.parse(event.payload); } catch { return event.payload; } })()
              });
              safeEnqueue(`data: ${data}\n\n`);
              currentSeq = event.seq;
            }
            safeEnqueue(`data: ${JSON.stringify({ done: true, state: updatedJob?.state || 'unknown' })}\n\n`);
            safeClose();
            return;
          }

          // Read new events from log
          const newEvents = await getJobHistory(jobId, currentSeq);
          if (newEvents.length > 0) {
            idleChecks = 0; // Reset idle counter when we get events
            for (const event of newEvents) {
              const data = JSON.stringify({
                ...event,
                payload: (() => { try { return JSON.parse(event.payload); } catch { return event.payload; } })()
              });
              safeEnqueue(`data: ${data}\n\n`);
              currentSeq = event.seq;
            }
          } else {
            idleChecks++;
          }
        }

        // Timeout - close the stream
        safeEnqueue(`data: ${JSON.stringify({ done: true, state: 'timeout' })}\n\n`);
        safeClose();
      } catch (error: any) {
        // Ignore connection reset errors (client disconnected)
        if (error?.code !== 'ECONNRESET' && error?.message !== 'aborted') {
          console.error('[SSE] Stream error:', error);
        }
        safeClose();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
