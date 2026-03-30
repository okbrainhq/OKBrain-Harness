import { NextRequest, NextResponse } from 'next/server';
import { createJob, getJob } from '@/lib/jobs';
import { getSession } from '@/lib/auth';

// POST /api/jobs - Create a new job
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type, id } = body;

    if (!type) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 });
    }

    const job = await createJob(type, id, session.userId);
    return NextResponse.json(job);
  } catch (error) {
    console.error('[API] Error creating job:', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}
