import { getConversation, setConversationActiveJob } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { createJob, startJob } from "@/lib/jobs";
import { SummarizeJobInput } from "@/workers/summarize-worker";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const userId = session.userId;

    const { conversationId } = await request.json();

    if (!conversationId) {
      return new Response(JSON.stringify({ error: "Conversation ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify conversation exists and belongs to user
    const conversation = await getConversation(userId, conversationId);
    if (!conversation) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create and start job
    const job = await createJob('summarize', undefined, userId);

    const jobInput: SummarizeJobInput = {
      userId,
      conversationId,
    };

    await startJob(job.id, jobInput);

    // Set active job ID on conversation for SSR resume
    await setConversationActiveJob(userId, conversationId, job.id);

    return new Response(JSON.stringify({
      jobId: job.id,
      conversationId,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Summarize error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process summary" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
