import { getSession } from "@/lib/auth";
import { createJob, startJob, getJob } from "@/lib/jobs";
import { v4 as uuidv4 } from "uuid";

export async function POST() {
  if (!process.env.TEST_MODE) {
    return new Response(JSON.stringify({ error: "Not available" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const jobId = uuidv4();
  await createJob("fact-extraction", jobId);
  await startJob(jobId, {});

  // Poll for job completion
  const maxWait = 300_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const job = await getJob(jobId);
    if (job && (job.state === "succeeded" || job.state === "failed")) {
      return new Response(JSON.stringify({ jobId, state: job.state }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return new Response(JSON.stringify({ jobId, state: "timeout" }), {
    status: 408,
    headers: { "Content-Type": "application/json" },
  });
}
