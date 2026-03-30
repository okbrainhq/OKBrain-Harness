import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserKV, setUserKV } from "@/lib/db";
import { getJob, getJobHistory, createJob, startJob, deleteJob } from "@/lib/jobs";

export type HighlightView = "today" | "tomorrow" | "week";

const KEY_PROMPT = "highlights:prompt";
const DEFAULT_PROMPT = "Show me events and interesting things.";

const COOLDOWNS: Record<HighlightView, number> = {
  today: 60 * 60 * 1000,          // 1 hour
  tomorrow: 6 * 60 * 60 * 1000,   // 6 hours
  week: 6 * 60 * 60 * 1000,       // 6 hours
};

function parseView(raw: string | null): HighlightView {
  if (raw === "tomorrow" || raw === "week") return raw;
  return "today";
}

function getJobId(userId: string, view: HighlightView): string {
  return `highlights:${userId}:${view}`;
}

async function getPrompt(userId: string): Promise<string> {
  const stored = await getUserKV(userId, KEY_PROMPT);
  return stored?.value || DEFAULT_PROMPT;
}

// Reconstruct highlight text from job history output events
async function getHighlightFromJob(jobId: string): Promise<string | null> {
  const events = await getJobHistory(jobId);
  const outputEvents = events.filter(e => e.kind === 'output');
  if (outputEvents.length === 0) return null;

  return outputEvents
    .map(e => {
      try {
        const payload = JSON.parse(e.payload);
        return payload.text || '';
      } catch {
        return '';
      }
    })
    .join('');
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prompt = await getPrompt(session.userId);

  // Return all three views in one response
  const views: Record<string, {
    highlight: string | null;
    lastRunAt: string | null;
    jobId: string;
    jobState: string | null;
    isRunning: boolean;
  }> = {};

  for (const view of ["today", "tomorrow", "week"] as HighlightView[]) {
    const jobId = getJobId(session.userId, view);
    const job = await getJob(jobId);

    // Get highlight from job history if job succeeded
    const highlight = job?.state === 'succeeded'
      ? await getHighlightFromJob(jobId)
      : null;

    views[view] = {
      highlight,
      lastRunAt: job?.state === 'succeeded' ? job.updated_at : null,
      jobId,
      jobState: job?.state || null,
      isRunning: job?.state === 'running' || job?.state === 'stopping',
    };
  }

  return NextResponse.json({ prompt, views });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const force = body.force ?? false;
  const view = parseView(body.view ?? null);
  const location = body.location;

  const jobId = getJobId(session.userId, view);
  let job = await getJob(jobId);

  // If job is in a non-terminal active state (idle, running, stopping), don't delete it
  // 'idle' means job is queued and waiting for worker - deleting it would cause race conditions
  if (job && (job.state === 'idle' || job.state === 'running' || job.state === 'stopping')) {
    return NextResponse.json({
      jobId,
      state: job.state,
      message: 'Job already in progress',
    });
  }

  // Check cooldown based on job's updated_at
  if (job && job.state === 'succeeded' && !force) {
    const lastRunTime = new Date(job.updated_at).getTime();
    if (Date.now() - lastRunTime < COOLDOWNS[view]) {
      return NextResponse.json({ skipped: true, reason: 'cooldown', jobId });
    }
  }

  // Delete existing job to start fresh (cleans up old events)
  if (job) {
    await deleteJob(jobId);
  }

  // Create new job
  job = await createJob('highlights', jobId, session.userId);

  const userPrompt = await getPrompt(session.userId);

  // Start the job
  await startJob(jobId, {
    userId: session.userId,
    view,
    userPrompt,
    location,
  });

  return NextResponse.json({
    jobId,
    state: 'running',
    view,
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prompt } = await req.json();

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ error: "Invalid prompt" }, { status: 400 });
  }
  if (prompt.length > 10_000) {
    return NextResponse.json({ error: "Prompt must be 10,000 characters or fewer" }, { status: 400 });
  }

  await setUserKV(session.userId, KEY_PROMPT, prompt.trim());

  return NextResponse.json({ success: true, prompt: prompt.trim() });
}
