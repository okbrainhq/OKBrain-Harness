import { test, expect } from "@playwright/test";
import * as path from "path";
import {
    loadTestEnv,
    setupPageWithUser,
    waitForChatCompletion,
} from "./test-utils";

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

test.describe("Background Tasks Tab", () => {
    test.describe.configure({ mode: "parallel" });

    test("background tasks tab appears after yield with correct count and updates state", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `bg-tab-e2e-${Date.now()}`;
        const command = `sleep 15; echo "${token}"`;
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

        // Background tasks tab should be visible
        const tab = page.locator('.background-tasks-tab');
        await expect(tab).toBeVisible({ timeout: 10000 });

        // Should show "1 background task running" (not more)
        const toggle = page.locator('.background-tasks-toggle');
        await expect(toggle).toContainText("1 background task running", { timeout: 5000 });

        // When the background job completes, the tab should disappear
        // (completed jobs are no longer shown)
        await expect(tab).toBeHidden({ timeout: 30000 });

        // Wait for resume to complete
        await waitForYieldResumed(conversationId, 90000);
    });

    test("background tasks tab expands to show tool jobs", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `bg-tab-expand-e2e-${Date.now()}`;
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

        // Wait for tab to appear
        const toggle = page.locator('.background-tasks-toggle');
        await expect(toggle).toBeVisible({ timeout: 10000 });

        // Click to expand
        await toggle.click();

        // Should show the shell command renderer with the command
        const shellCard = page.locator('.background-tasks-tab').locator("button", {
            hasText: "run_shell_command",
        });
        await expect(shellCard.first()).toBeVisible({ timeout: 5000 });

        // Wait for resume
        await waitForYieldResumed(conversationId, 90000);
    });

    test("background tasks tab persists after page reload", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `bg-tab-reload-e2e-${Date.now()}`;
        const command = `sleep 15; echo "${token}"`;
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

        // Wait for tab to appear
        const tab = page.locator('.background-tasks-tab');
        await expect(tab).toBeVisible({ timeout: 10000 });

        // Reload the page
        await page.reload();
        await page.waitForLoadState("domcontentloaded");

        // Input should still be enabled
        await expect(input).toBeEnabled({ timeout: 15000 });

        // Background tasks tab should still be visible after reload
        await expect(tab).toBeVisible({ timeout: 15000 });

        // Wait for resume
        await waitForYieldResumed(conversationId, 90000);

        // After resume completes, the tab should disappear
        await expect(tab).toBeHidden({ timeout: 30000 });
    });

    test("multiple yielded tools show correct running count", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token1 = `bg-multi-first-${Date.now()}`;
        const token2 = `bg-multi-second-${Date.now()}`;
        const command1 = `sleep 30; echo "${token1}"`;
        const command2 = `sleep 35; echo "${token2}"`;

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

        // Wait for yield via DB
        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);

        // Background tasks tab should be visible
        const toggle = page.locator('.background-tasks-toggle');
        await expect(toggle).toBeVisible({ timeout: 10000 });

        // Should show "2 background tasks running"
        await expect(toggle).toContainText("2 background tasks running", { timeout: 5000 });

        // Wait for resume
        await waitForYieldResumed(conversationId, 90000);

        // Tab disappears
        const tab = page.locator('.background-tasks-tab');
        await expect(tab).toBeHidden({ timeout: 30000 });
    });

    test("tab persists when one job completes while another is still running", async ({
        page,
    }) => {
        test.setTimeout(180000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const input = page.locator('textarea[placeholder="Ask me anything..."]');

        // First message: short-running command
        const token1 = `bg-concurrent-short-${Date.now()}`;
        const prompt1 = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: sleep 15; echo "${token1}"`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token1}`,
        ].join(" ");

        await input.fill(prompt1);
        await input.press("Enter");

        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);

        // Tab should be visible with first job
        const tab = page.locator('.background-tasks-tab');
        const toggle = page.locator('.background-tasks-toggle');
        await expect(tab).toBeVisible({ timeout: 10000 });
        await expect(toggle).toContainText("1 background task running", { timeout: 5000 });

        // Input should be enabled after yield
        await expect(input).toBeEnabled({ timeout: 10000 });

        // Second message: longer-running command
        const token2 = `bg-concurrent-long-${Date.now()}`;
        const prompt2 = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: sleep 30; echo "${token2}"`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token2}`,
        ].join(" ");

        await input.fill(prompt2);
        await input.press("Enter");

        // Wait for second yield session
        await waitForCondition(() => {
            const db = getDb();
            const count = db
                .prepare(
                    `SELECT COUNT(*) as cnt FROM chat_yield_sessions
                     WHERE conversation_id = ? AND state = 'waiting'`
                )
                .get(conversationId) as any;
            db.close();
            // We need the second yield to be created (first may already be resumed)
            return count?.cnt >= 1 ? true : null;
        }, 30000);

        // Tab should still be visible (now possibly 2 tasks or at least 1)
        await expect(tab).toBeVisible({ timeout: 10000 });

        // Wait for the first job to complete and its resume to finish
        await waitForCondition(() => {
            const db = getDb();
            const row = db
                .prepare(
                    `SELECT * FROM chat_yield_sessions
                     WHERE conversation_id = ? AND state = 'resumed'
                     ORDER BY created_at ASC LIMIT 1`
                )
                .get(conversationId);
            db.close();
            return row;
        }, 60000);

        // Key assertion: tab should STILL be visible because second job is still running
        await expect(tab).toBeVisible({ timeout: 10000 });
        await expect(toggle).toContainText("background task running", { timeout: 10000 });

        // Wait for everything to finish
        await waitForCondition(() => {
            const db = getDb();
            const waiting = db
                .prepare(
                    `SELECT COUNT(*) as cnt FROM chat_yield_sessions
                     WHERE conversation_id = ? AND state = 'waiting'`
                )
                .get(conversationId) as any;
            db.close();
            return waiting?.cnt === 0 ? true : null;
        }, 90000);

        // Tab should eventually disappear
        await expect(tab).toBeHidden({ timeout: 60000 });
    });

    test("background tasks tab only shows on the conversation with running jobs", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `bg-scoped-e2e-${Date.now()}`;
        const command = `sleep 20; echo "${token}"`;
        const prompt = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: ${command}`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token}`,
        ].join(" ");

        const input = page.locator('textarea[placeholder="Ask me anything..."]');
        await input.fill(prompt);
        await input.press("Enter");

        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);

        // Tab should be visible on this conversation
        const tab = page.locator('.background-tasks-tab');
        await expect(tab).toBeVisible({ timeout: 10000 });

        // Navigate to home — tab should NOT be visible (different page, no yielded jobs here)
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await expect(tab).toBeHidden({ timeout: 5000 });

        // Verify DB still has active yield session
        const activeSession = await waitForCondition(() => {
            const db = getDb();
            const row = db
                .prepare(
                    `SELECT * FROM chat_yield_sessions
                     WHERE conversation_id = ? AND state IN ('waiting', 'resume_queued')
                     LIMIT 1`
                )
                .get(conversationId);
            db.close();
            return row;
        }, 5000);
        expect(activeSession).toBeTruthy();

        // Wait for resume to complete
        await waitForYieldResumed(conversationId, 90000);
    });

    test("page reload with concurrent jobs restores all running jobs", async ({
        page,
    }) => {
        test.setTimeout(180000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const input = page.locator('textarea[placeholder="Ask me anything..."]');

        // First message
        const token1 = `bg-reload-first-${Date.now()}`;
        const prompt1 = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: sleep 20; echo "${token1}"`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token1}`,
        ].join(" ");

        await input.fill(prompt1);
        await input.press("Enter");

        const conversationId = await getConversationIdFromUrl(page);
        await waitForYieldSession(conversationId);

        await expect(input).toBeEnabled({ timeout: 10000 });

        // Second message
        const token2 = `bg-reload-second-${Date.now()}`;
        const prompt2 = [
            "Use the run_shell_command tool now.",
            `Run exactly this command: sleep 25; echo "${token2}"`,
            "Do not use any other tool.",
            "If the tool yields, emit the required <yeild> note and continue when results are available.",
            `After completion, include this token in the final answer: ${token2}`,
        ].join(" ");

        await input.fill(prompt2);
        await input.press("Enter");

        // Wait for both yield sessions to be created
        await waitForCondition(() => {
            const db = getDb();
            const count = db
                .prepare(
                    `SELECT COUNT(*) as cnt FROM chat_yield_sessions
                     WHERE conversation_id = ? AND state IN ('waiting', 'resume_queued')`
                )
                .get(conversationId) as any;
            db.close();
            return count?.cnt >= 2 ? true : null;
        }, 30000);

        // Tab should show 2 tasks
        const tab = page.locator('.background-tasks-tab');
        const toggle = page.locator('.background-tasks-toggle');
        await expect(tab).toBeVisible({ timeout: 10000 });
        await expect(toggle).toContainText("2 background tasks running", { timeout: 10000 });

        // Reload the page
        await page.reload();
        await page.waitForLoadState("domcontentloaded");

        // Tab should still show 2 tasks after reload
        await expect(tab).toBeVisible({ timeout: 15000 });
        await expect(toggle).toContainText("2 background tasks running", { timeout: 15000 });

        // Wait for everything to complete
        await waitForCondition(() => {
            const db = getDb();
            const waiting = db
                .prepare(
                    `SELECT COUNT(*) as cnt FROM chat_yield_sessions
                     WHERE conversation_id = ? AND state = 'waiting'`
                )
                .get(conversationId) as any;
            db.close();
            return waiting?.cnt === 0 ? true : null;
        }, 90000);

        await expect(tab).toBeHidden({ timeout: 60000 });
    });

    test("background tasks tab disappears after resume completes", async ({
        page,
    }) => {
        test.setTimeout(120000);
        await setupPageWithUser(page);

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        await page.locator("#ai-provider").selectOption("gemini");

        const token = `bg-tab-disappear-e2e-${Date.now()}`;
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

        // Tab should be visible during yield
        const tab = page.locator('.background-tasks-tab');
        await expect(tab).toBeVisible({ timeout: 10000 });

        // Wait for resume to complete
        await waitForYieldResumed(conversationId, 90000);

        // Tab should disappear after resume
        await expect(tab).toBeHidden({ timeout: 30000 });

        // The token should appear in the chat as part of the resume response
        await expect(page.locator(`text=${token}`).first()).toBeVisible({
            timeout: 30000,
        });
    });
});
