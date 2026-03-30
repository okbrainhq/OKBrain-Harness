import { NextRequest, NextResponse } from 'next/server';
import { startJob, getJob } from '@/lib/jobs';
import { getSession } from '@/lib/auth';

// POST /api/jobs/:jobId/start - Start a job with input
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
    const body = await request.json();
    const { input, priority = 0 } = body;

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Validate ownership: if job has a user_id, only the owner can start it
    if (job.user_id && job.user_id !== session.userId) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.state === 'running' || job.state === 'stopping') {
      return NextResponse.json(
        { error: `Job is already ${job.state}` },
        { status: 409 }
      );
    }

    const result = await startJob(jobId, input, priority);
    return NextResponse.json({ ...job, ...result });
  } catch (error) {
    console.error('[API] Error starting job:', error);
    return NextResponse.json({ error: 'Failed to start job' }, { status: 500 });
  }
}
