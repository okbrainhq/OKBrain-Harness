import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';
import { getSession } from '@/lib/auth';

// GET /api/jobs/:jobId - Get job details
export async function GET(
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

    // Validate ownership: if job has a user_id, only the owner can access it
    if (job.user_id && job.user_id !== session.userId) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error('[API] Error getting job:', error);
    return NextResponse.json({ error: 'Failed to get job' }, { status: 500 });
  }
}
