import { test, expect } from "@playwright/test";
import { v4 as uuidv4 } from "uuid";
import * as path from "path";
import {
    loadTestEnv,
    createUniqueUser,
    setupPageWithUser,
    waitForChatCompletion,
} from "./test-utils";
import {
    addConversationToolJob,
    addToolCallLog,
    createConversation,
    getConversationToolJobByJobId,
    getToolCallLogByToolCallId,
    markToolCallLogYielded,
} from "../src/lib/db";
import { createJob, getJob, updateJobState } from "../src/lib/jobs";
import { executeTool } from "../src/lib/ai/tools";
import { runWithToolContext } from "../src/lib/ai/tools/context";

loadTestEnv();

function getDb() {
    const Database = require("better-sqlite3");
    const dbPath = path.resolve(process.env.TEST_DB_PATH || "brain.test.db");
    return new Database(dbPath);
}

async function waitForCondition<T>(
    check: () => T | null | undefined,
    timeoutMs: number = 60000,
    intervalMs: number = 500,
): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = check();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

async function getConversationIdFromUrl(page: any, timeoutMs: number = 60000): Promise<string> {
    await page.waitForURL("**/chat/**", { timeout: timeoutMs });
    const url = page.url();
    const conversationId = url.split("/chat/")[1]?.split("?")[0];
    if (!conversationId) throw new Error("Could not extract conversation ID from URL");
    return conversationId;
}

async function waitForYieldSession(conversationId: string, timeoutMs: number = 30000): Promise<any> {
    return waitForCondition(() => {
        const db = getDb();
        const row = db
            .prepare(
                `
        SELECT *
        FROM chat_yield_sessions
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
            )
            .get(conversationId);
        db.close();
        return row;
    }, timeoutMs);
}

async function waitForYieldResumed(conversationId: string, timeoutMs: number = 60000): Promise<any> {
    return waitForCondition(() => {
        const db = getDb();
        const row = db
            .prepare(
                `
        SELECT *
        FROM chat_yield_sessions
        WHERE conversation_id = ?
          AND state = 'resumed'
        ORDER BY created_at DESC
        LIMIT 1
      `,
            )
            .get(conversationId);
        db.close();
        return row;
    }, timeoutMs);
}

test.describe("Yield Resume Kill Tool Job", () => {
    test.describe.configure({ mode: "parallel" });

    test("kill_tool_call_job stops a yielded tool call and is idempotent", async () => {
        const user = await createUniqueUser();
        const conversationId = uuidv4();
        await createConversation(
            user.id,
            conversationId,
            "Kill Tool Call Job Test",
        );

        const parentJob = await createJob("chat", undefined, user.id);
        const asyncToolJob = await createJob(
            "shell-command",
            undefined,
            user.id,
        );
        await updateJobState(asyncToolJob.id, "running");

        await addConversationToolJob(
            uuidv4(),
            conversationId,
            parentJob.id,
            asyncToolJob.id,
            "run_shell_command",
            { command: "sleep 60" },
        );

        const toolCallLog = await addToolCallLog(
            conversationId,
            "run_shell_command",
            { command: "sleep 60" },
            { parentJobId: parentJob.id },
        );

        await markToolCallLogYielded(toolCallLog.id, {
            asyncJobId: asyncToolJob.id,
            response: {
                status: "yielded",
                tool_call_id: toolCallLog.tool_call_id,
                job_id: asyncToolJob.id,
            },
        });

        const result = await runWithToolContext(
            {
                userId: user.id,
                conversationId,
                parentJobId: parentJob.id,
            },
            () =>
                executeTool("kill_tool_call_job", {
                    tool_call_id: toolCallLog.tool_call_id,
                    signal: "TERM",
                    reason: "integration test stop",
                }),
        );

        expect(result.no_op).toBe(false);
        expect(result.tool_call_id).toBe(toolCallLog.tool_call_id);
        expect(result.async_job_id).toBe(asyncToolJob.id);
        expect(result.previous_status).toBe("yielded");
        expect(result.final_status).toBe("failed");
        expect(result.final_job_state).toBe("stopped");

        const updatedLog = await getToolCallLogByToolCallId(
            conversationId,
            toolCallLog.tool_call_id,
        );
        expect(updatedLog).toBeTruthy();
        expect(updatedLog!.status).toBe("failed");
        expect(updatedLog!.completed_at).toBeTruthy();
        expect(updatedLog!.error).toContain("kill_tool_call_job");

        const updatedToolJob = await getConversationToolJobByJobId(
            asyncToolJob.id,
        );
        expect(updatedToolJob).toBeTruthy();
        expect(updatedToolJob!.state).toBe("stopped");
        expect(updatedToolJob!.error).toContain("kill_tool_call_job");

        const asyncJobState = await getJob(asyncToolJob.id);
        expect(asyncJobState).toBeTruthy();
        expect(asyncJobState!.state).toBe("stopping");

        const secondResult = await runWithToolContext(
            {
                userId: user.id,
                conversationId,
                parentJobId: parentJob.id,
            },
            () =>
                executeTool("kill_tool_call_job", {
                    tool_call_id: toolCallLog.tool_call_id,
                    signal: "TERM",
                }),
        );

        expect(secondResult.no_op).toBe(true);
    });

    test("yields long shell command, closes parent stream, and resumes after polling", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `yield-resume-e2e-${Date.now()}`;
        const command = `sleep 20; echo "${token}"`;
        const prompt = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: ${command}`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token}`,
        ].join(" ");

        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(prompt);
        await input.press("Enter");

        const toolHeader = page
            .locator("button", { hasText: "run_shell_command" })
            .first();
        await expect(toolHeader).toBeVisible({ timeout: 60000 });

        // Wait for conversation ID and yield session via DB
        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);

        // Input should be enabled after yield (non-blocking)
        await expect(input).toBeEnabled({ timeout: 10000 });

        // Wait for resume to complete
        await waitForYieldResumed(conversationId, 90000);

        await toolHeader.click();
        await expect(page.locator(`text=${token}`).first()).toBeVisible({
            timeout: 30000,
        });
        await expect(page.locator("text=Succeeded").first()).toBeVisible({
            timeout: 30000,
        });

        const db = getDb();
        const session = db
            .prepare(
                `
      SELECT *
      FROM chat_yield_sessions
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
            )
            .get(conversationId);
        expect(session).toBeTruthy();
        expect(session.state).toBe("resumed");
        expect(session.resume_reason).toBe("all_completed");
        expect(typeof session.yield_note).toBe("string");
        expect(session.yield_note.length).toBeGreaterThan(0);
        expect(session.partial_output).not.toBeUndefined();
        expect(session.partial_thoughts).not.toBeUndefined();
        expect(session.partial_thinking_duration).not.toBeUndefined();

        const legacyResumeJobs = db
            .prepare(
                `
      SELECT COUNT(*) AS count
      FROM jobs j
      JOIN job_events e ON e.job_id = j.id AND e.kind = 'input'
      WHERE j.type = 'chat-yield-resume'
        AND e.payload LIKE ?
    `,
            )
            .get(`%${session.id}%`) as { count: number };
        expect(legacyResumeJobs.count).toBe(0);

        // Check assistant response via chat_events (events system replaced messages table)
        const assistantTextEvents = db
            .prepare(
                `
      SELECT content
      FROM chat_events
      WHERE conversation_id = ?
        AND kind = 'assistant_text'
      ORDER BY seq DESC
    `,
            )
            .all(conversationId) as Array<{ content: string }>;
        expect(assistantTextEvents.length).toBeGreaterThan(0);
        const fullAssistantContent = assistantTextEvents
            .reverse()
            .map((e: { content: string }) => {
                try { const c = JSON.parse(e.content); return c.text || ''; } catch { return ''; }
            })
            .join('');
        if (session.partial_output && session.partial_output.length > 0) {
            expect(fullAssistantContent).toContain(session.partial_output);
        }
        if (session.partial_thoughts && session.partial_thoughts.length > 0) {
            const thoughtEvents = db
                .prepare(
                    `
        SELECT content
        FROM chat_events
        WHERE conversation_id = ?
          AND kind = 'thought'
        ORDER BY seq ASC
      `,
                )
                .all(conversationId) as Array<{ content: string }>;
            const fullThoughts = thoughtEvents
                .map((e: { content: string }) => {
                    try { const c = JSON.parse(e.content); return c.text || ''; } catch { return ''; }
                })
                .join('');
            expect(fullThoughts).toContain(session.partial_thoughts);
        }

        const toolLog = db
            .prepare(
                `
      SELECT *
      FROM tool_call_logs
      WHERE conversation_id = ?
        AND tool_name = 'run_shell_command'
      ORDER BY CAST(tool_call_id AS INTEGER) DESC
      LIMIT 1
    `,
            )
            .get(conversationId);
        db.close();

        expect(toolLog).toBeTruthy();
        expect(toolLog.async_job_id).toBeTruthy();
        expect(toolLog.yielded_at).toBeTruthy();
        expect(toolLog.completed_at).toBeTruthy();
        expect(toolLog.status).toBe("succeeded");
    });

    test("input is enabled after yield and user can send a new message", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `yield-input-e2e-${Date.now()}`;
        const command = `sleep 8; echo "${token}"`;
        const prompt = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: ${command}`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token}`,
        ].join(" ");

        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(prompt);
        await input.press("Enter");

        // Wait for yield via DB
        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);

        // Input should be enabled after yield (non-blocking)
        await expect(input).toBeEnabled({ timeout: 10000 });

        // Send a second message (simple question that doesn't use tools)
        await input.fill("What is 2+2? Answer with just the number.");
        await input.press("Enter");

        // Wait for the second response to complete
        await waitForChatCompletion(page, 30000);

        // Wait for the yield session to be resumed
        await waitForYieldResumed(conversationId, 60000);

        // DB check: one yield session in resumed state
        const db = getDb();
        const sessions = db
            .prepare(
                `
      SELECT *
      FROM chat_yield_sessions
      WHERE conversation_id = ?
    `,
            )
            .all(conversationId);
        db.close();

        expect(sessions.length).toBe(1);
        expect(sessions[0].state).toBe("resumed");
        expect(sessions[0].resume_reason).toBe("all_completed");
    });

    test("yield session is not cancelled when user sends a normal message", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `yield-nocancel-e2e-${Date.now()}`;
        const command = `sleep 10; echo "${token}"`;
        const prompt = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: ${command}`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token}`,
        ].join(" ");

        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(prompt);
        await input.press("Enter");

        // Wait for yield via DB
        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);

        // Input should be enabled after yield
        await expect(input).toBeEnabled({ timeout: 10000 });

        // Send a follow-up message (no tools)
        await input.fill("What is the capital of France? Answer briefly.");
        await input.press("Enter");

        // Wait for follow-up response
        await waitForChatCompletion(page, 30000);

        // DB check: yield session should still be waiting (not cancelled)
        const db1 = getDb();
        const sessionAfterSend = db1
            .prepare(
                `
      SELECT *
      FROM chat_yield_sessions
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
            )
            .get(conversationId);
        db1.close();

        expect(sessionAfterSend).toBeTruthy();
        expect(sessionAfterSend.state).not.toBe("cancelled");

        // Wait for tool to complete and resume
        await waitForYieldResumed(conversationId, 60000);

        // DB check: yield session transitioned to resumed
        const db2 = getDb();
        const finalSession = db2
            .prepare(
                `
      SELECT *
      FROM chat_yield_sessions
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
            )
            .get(conversationId);
        db2.close();

        expect(finalSession.state).toBe("resumed");
        expect(finalSession.resume_reason).toBe("all_completed");
    });

    test("no timeout — yield session has null deadline_at and resumes as all_completed", async ({
        page,
    }) => {
        test.setTimeout(90000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `yield-no-timeout-e2e-${Date.now()}`;
        const command = `sleep 8; echo "${token}"`;
        const prompt = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: ${command}`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token}`,
        ].join(" ");

        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(prompt);
        await input.press("Enter");

        // Wait for yield via DB
        const conversationId = await getConversationIdFromUrl(page);
        const session = await waitForYieldSession(conversationId);

        // DB check: yield session has far-future deadline (no real timeout)
        expect(session.deadline_at).toContain("9999");

        // Wait for tool to complete and resume
        const resumedSession = await waitForYieldResumed(conversationId, 60000);

        expect(resumedSession.resume_reason).toBe("all_completed");
        expect(resumedSession.timed_out_at).toBeFalsy();
    });

    test("keeps waiting state across reload and still auto-resumes", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `yield-reload-e2e-${Date.now()}`;
        const command = `sleep 12; echo "${token}"`;
        const prompt = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: ${command}`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token}`,
        ].join(" ");

        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(prompt);
        await input.press("Enter");

        // Wait for yield via DB
        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);

        await page.reload();
        await page.waitForLoadState("domcontentloaded");

        // After reload with pending yields, input should be enabled (non-blocking)
        await expect(input).toBeEnabled({ timeout: 15000 });

        // Wait for tool to complete and resume
        await waitForYieldResumed(conversationId, 60000);

        // Verify the loading indicator disappears after resume
        await expect(
            page
                .locator(".chat-item.active")
                .first()
                .locator(".chat-item-icon-loading"),
        ).toHaveCount(0, { timeout: 30000 });
    });

    test("command completes without yielding when under threshold", async ({
        page,
    }) => {
        test.setTimeout(60000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.locator("#ai-provider").selectOption("gemini");

        const token = `no-yield-e2e-${Date.now()}`;
        const command = `sleep 1; echo "${token}"`;
        const prompt = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: ${command}`,
            "Do not use any other tool.",
            `After completion, include this token in the final answer: ${token}`,
        ].join(" ");

        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(prompt);
        await input.press("Enter");

        const toolHeader = page
            .locator("button", { hasText: "run_shell_command" })
            .first();
        await expect(toolHeader).toBeVisible({ timeout: 60000 });

        await expect(page.locator(`text=${token}`).first()).toBeVisible({
            timeout: 30000,
        });
        await expect(page.locator("text=Succeeded").first()).toBeVisible({
            timeout: 30000,
        });
        await waitForChatCompletion(page, 30000);

        const url = page.url();
        const conversationId = url.split("/chat/")[1]?.split("?")[0];
        expect(conversationId).toBeTruthy();

        const db = getDb();
        const toolLog = db
            .prepare(
                `
      SELECT *
      FROM tool_call_logs
      WHERE conversation_id = ?
        AND tool_name = 'run_shell_command'
      ORDER BY CAST(tool_call_id AS INTEGER) DESC
      LIMIT 1
    `,
            )
            .get(conversationId);

        expect(toolLog).toBeTruthy();
        expect(toolLog.status).toBe("succeeded");
        expect(toolLog.yielded_at).toBeFalsy();
        expect(toolLog.async_job_id).toBeFalsy();

        const session = db
            .prepare(
                `
      SELECT COUNT(*) as count
      FROM chat_yield_sessions
      WHERE conversation_id = ?
    `,
            )
            .get(conversationId) as { count: number };
        db.close();

        expect(session.count).toBe(0);
    });

    test("protocol failure when model omits <yeild> tag cancels background jobs", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.locator("#ai-provider").selectOption("gemini");

        const token = `protocol-fail-e2e-${Date.now()}`;
        const command = `sleep 20; echo "${token}"`;
        const prompt = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: ${command}`,
            "Do not use any other tool.",
            "IMPORTANT: When the tool yields, do NOT emit a <yeild> tag.",
            "Just say the tool is running and end your response normally.",
        ].join(" ");

        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(prompt);
        await input.press("Enter");

        const toolHeader = page
            .locator("button", { hasText: "run_shell_command" })
            .first();
        await expect(toolHeader).toBeVisible({ timeout: 60000 });

        await expect(
            page.locator("text=run_shell_command").first(),
        ).toBeVisible({ timeout: 60000 });
        await waitForChatCompletion(page, 120000);

        const url = page.url();
        const conversationId = url.split("/chat/")[1]?.split("?")[0];
        expect(conversationId).toBeTruthy();

        const db = getDb();
        const toolLog = db
            .prepare(
                `
      SELECT *
      FROM tool_call_logs
      WHERE conversation_id = ?
        AND tool_name = 'run_shell_command'
      ORDER BY CAST(tool_call_id AS INTEGER) DESC
      LIMIT 1
    `,
            )
            .get(conversationId);

        expect(toolLog).toBeTruthy();
        expect(toolLog.status).toBe("failed");
        expect(toolLog.yielded_at).toBeTruthy();
        expect(toolLog.async_job_id).toBeTruthy();
        expect(toolLog.error).toContain("cancelled");
        expect(toolLog.completed_at).toBeTruthy();

        const session = db
            .prepare(
                `
      SELECT COUNT(*) as count
      FROM chat_yield_sessions
      WHERE conversation_id = ?
    `,
            )
            .get(conversationId) as { count: number };
        db.close();

        expect(session.count).toBe(0);
    });

    test("two yielded calls result in single resume", async ({ page }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.locator("#ai-provider").selectOption("gemini");

        const token1 = `two-yield-first-${Date.now()}`;
        const token2 = `two-yield-second-${Date.now()}`;
        const command1 = `sleep 8; echo "${token1}"`;
        const command2 = `sleep 9; echo "${token2}"`;

        const prompt = [
            "Use the run_shell_command tool twice.",
            `First command: ${command1}`,
            `Second command: ${command2}`,
            "If the tools yield, emit the required <yeild> note and continue when results are available.",
            `After both complete, include both tokens in the final answer: ${token1} and ${token2}`,
        ].join(" ");

        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(prompt);
        await input.press("Enter");

        const toolHeaders = page.locator("button", {
            hasText: "run_shell_command",
        });
        await expect(toolHeaders.first()).toBeVisible({ timeout: 60000 });

        // Wait for yield via DB
        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);

        // Wait for resume to complete
        await waitForYieldResumed(conversationId, 90000);

        await toolHeaders.first().click();
        await expect(page.locator(`text=${token1}`).first()).toBeVisible({
            timeout: 30000,
        });
        await expect(page.locator(`text=${token2}`).first()).toBeVisible({
            timeout: 30000,
        });
        await expect(page.locator("text=Succeeded").first()).toBeVisible({
            timeout: 30000,
        });

        const db = getDb();

        const sessions = db
            .prepare(
                `
      SELECT *
      FROM chat_yield_sessions
      WHERE conversation_id = ?
      ORDER BY created_at DESC
    `,
            )
            .all(conversationId);

        expect(sessions.length).toBe(1);
        expect(sessions[0].state).toBe("resumed");
        expect(sessions[0].resume_reason).toBe("all_completed");

        const toolLogs = db
            .prepare(
                `
      SELECT *
      FROM tool_call_logs
      WHERE conversation_id = ?
        AND tool_name = 'run_shell_command'
        AND status = 'succeeded'
    `,
            )
            .all(conversationId);
        db.close();

        expect(toolLogs.length).toBe(2);
        expect(toolLogs[0].yielded_at).toBeTruthy();
        expect(toolLogs[1].yielded_at).toBeTruthy();
        expect(toolLogs[0].async_job_id).toBeTruthy();
        expect(toolLogs[1].async_job_id).toBeTruthy();
    });

    test("mixed outcomes - one succeeds and one fails in same resume", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.locator("#ai-provider").selectOption("gemini");

        const successToken = `mixed-success-${Date.now()}`;
        const failToken = `mixed-fail-${Date.now()}`;
        const successCommand = `sleep 8; echo "${successToken}"`;
        const failCommand = `sleep 8; echo "${failToken}"; exit 1`;

        const prompt = [
            "Use the run_shell_command tool twice.",
            `First command (should succeed): ${successCommand}`,
            `Second command (should fail): ${failCommand}`,
            "If the tools yield, emit the required <yeild> note and continue when results are available.",
            `Mention both ${successToken} and ${failToken} in your response.`,
        ].join(" ");

        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(prompt);
        await input.press("Enter");

        const toolHeaders = page.locator("button", {
            hasText: "run_shell_command",
        });
        await expect(toolHeaders.first()).toBeVisible({ timeout: 60000 });

        // Wait for yield and resume via DB
        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);
        await waitForYieldResumed(conversationId, 90000);

        await toolHeaders.first().click();
        await expect(page.locator(`text=${successToken}`).first()).toBeVisible({
            timeout: 30000,
        });
        await expect(page.locator(`text=${failToken}`).first()).toBeVisible({
            timeout: 30000,
        });

        const db = getDb();

        const sessions = db
            .prepare(
                `
      SELECT *
      FROM chat_yield_sessions
      WHERE conversation_id = ?
    `,
            )
            .get(conversationId);

        expect(sessions).toBeTruthy();
        expect(sessions.state).toBe("resumed");

        const toolLogs = db
            .prepare(
                `
      SELECT *
      FROM tool_call_logs
      WHERE conversation_id = ?
        AND tool_name = 'run_shell_command'
      ORDER BY CAST(tool_call_id AS INTEGER) ASC
    `,
            )
            .all(conversationId);
        db.close();

        expect(toolLogs.length).toBe(2);

        const statuses = toolLogs.map((t: any) => t.status);
        expect(statuses).toContain("succeeded");
        expect(statuses).toContain("failed");

        toolLogs.forEach((log: any) => {
            expect(log.yielded_at).toBeTruthy();
            expect(log.async_job_id).toBeTruthy();
            expect(log.completed_at).toBeTruthy();
        });
    });

    test("generates conversation title during yield exit (before resume)", async ({
        page,
    }) => {
        test.setTimeout(60000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `yield-title-e2e-${Date.now()}`;
        const command = `sleep 5; echo "Title test token: ${token}"`;
        const prompt = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: ${command}`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token}`,
        ].join(" ");

        const input = page.locator(
            'textarea[placeholder="Ask me anything..."]',
        );
        await input.fill(prompt);
        await input.press("Enter");

        // Wait for yield session — title should be generated at yield exit, before resume
        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);

        // Verify title was generated in DB right after yield (before resume)
        await waitForCondition(() => {
            const db = getDb();
            const conversation = db
                .prepare(`SELECT title FROM conversations WHERE id = ?`)
                .get(conversationId) as any;
            db.close();
            if (conversation && conversation.title && conversation.title !== "New Chat") {
                return conversation;
            }
            return null;
        }, 15000);

        // Also verify in the UI
        const chatHistory = page.locator(".chat-history");
        await expect(chatHistory).toBeVisible({ timeout: 15000 });

        const chatItems = page.locator(".chat-item");
        await expect(chatItems.first()).toBeVisible({ timeout: 15000 });

        const firstChatTitle = chatItems.first().locator(".chat-item-title");
        await expect(firstChatTitle).not.toHaveText("New Chat", {
            timeout: 10000,
        });

        const titleText = await firstChatTitle.textContent();
        expect(titleText).toBeTruthy();
        expect(titleText!.length).toBeGreaterThan(3);
        expect(titleText).not.toBe("New Chat");
    });
});
