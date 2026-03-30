import { NextRequest, NextResponse } from 'next/server';
import { stopJob, getJob } from '@/lib/jobs';
import { getSession } from '@/lib/auth';

// POST /api/jobs/:jobId/stop - Stop a running job
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await params;

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Validate ownership: if job has a user_id, only the owner can stop it
    if (job.user_id && job.user_id !== session.userId) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    await stopJob(jobId);

    // Wait for the job to complete (worker does cleanup before completing)
    const maxWaitMs = 5000;
    const pollIntervalMs = 50;
    const startTime = Date.now();

    let updatedJob = await getJob(jobId);
    while (updatedJob && updatedJob.state === 'stopping' && (Date.now() - startTime) < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      updatedJob = await getJob(jobId);
    }

    return NextResponse.json(updatedJob);
  } catch (error) {
    console.error('[API] Error stopping job:', error);
    return NextResponse.json({ error: 'Failed to stop job' }, { status: 500 });
  }
}
