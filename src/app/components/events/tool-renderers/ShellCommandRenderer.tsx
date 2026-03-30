"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ToolRendererProps } from "./index";
import styles from "./ShellCommandRenderer.module.css";

export default function ShellCommandRenderer({
  toolName,
  callContent,
  resultContent,
  state: initialState,
  asyncJobId,
  sinceSeq = 0,
  onStateChange,
}: ToolRendererProps) {
  const isRunApp = toolName === 'run_app';
  const command = callContent?.command || callContent?.arguments?.command || "";
  const appArgs = callContent?.arguments?.args || "";
  const appName = callContent?.arguments?.app_name || "";
  const jobId = asyncJobId || resultContent?.async_job_id || resultContent?.job_id;

  // For finished results, initialise from resultContent
  const hasInlineResult =
    initialState !== "running" &&
    resultContent &&
    (resultContent.stdout !== undefined || resultContent.stderr !== undefined);

  const [stdout, setStdout] = useState(hasInlineResult ? resultContent.stdout || "" : "");
  const [stderr, setStderr] = useState(hasInlineResult ? resultContent.stderr || "" : "");
  const [exitCode, setExitCode] = useState<number | null>(
    hasInlineResult && typeof resultContent.exit_code === "number" ? resultContent.exit_code : null
  );
  const [durationMs, setDurationMs] = useState<number | null>(
    hasInlineResult && typeof resultContent.duration_ms === "number" ? resultContent.duration_ms : null
  );
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(
    hasInlineResult && resultContent.error ? resultContent.error : null
  );
  const [expanded, setExpanded] = useState(false);
  const [showArgs, setShowArgs] = useState(false);
  const userToggledRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const finished = state !== "running";

  const commandPreview = useMemo(() => {
    if (!command) return "";
    const lines = command.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
    if (lines.length === 0) return "";
    let preview = lines[0];
    if (preview.length > 110) {
      preview = `${preview.slice(0, 110)}...`;
    }
    if (lines.length > 1) {
      preview = `${preview} ...`;
    }
    return preview;
  }, [command]);

  // Notify parent of state changes
  useEffect(() => {
    if (state !== initialState && onStateChange) {
      onStateChange(state);
    }
  }, [state, initialState, onStateChange]);

  // Auto-scroll body when output grows
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [stdout, stderr]);

  // Collapse when finished (unless user toggled)
  useEffect(() => {
    if (finished && !userToggledRef.current) {
      setExpanded(false);
    }
  }, [finished]);

  // SSE streaming for running jobs
  useEffect(() => {
    if (finished || !jobId) return;
    const streamUrl = sinceSeq > 0
      ? `/api/jobs/${jobId}/stream?since_seq=${sinceSeq}`
      : `/api/jobs/${jobId}/stream`;
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.done) {
          if (data.state && data.state !== "running") {
            setState(data.state);
          }
          eventSource.close();
          return;
        }
        if (data.kind !== "output") return;
        const payload = data.payload || {};

        if (payload.stream === "stdout" && typeof payload.text === "string") {
          setStdout((prev: string) => prev + payload.text);
        }
        if (payload.stream === "stderr" && typeof payload.text === "string") {
          setStderr((prev: string) => prev + payload.text);
        }
        if (payload.type === "result") {
          if (typeof payload.exitCode === "number") setExitCode(payload.exitCode);
          if (typeof payload.durationMs === "number") setDurationMs(payload.durationMs);
          if (typeof payload.error === "string") setError(payload.error);
          setState(payload.state || (payload.exitCode === 0 ? "succeeded" : "failed"));
        }
      } catch {
        // Ignore malformed events
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setError((prev: string | null) => prev || "Connection lost");
    };

    return () => eventSource.close();
  }, [finished, jobId, sinceSeq]);

  // Hydrate from job history for finished jobs with no inline output (only when expanded)
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!expanded || !finished || stdout || stderr || !jobId || hydratedRef.current) return;
    hydratedRef.current = true;
    let cancelled = false;

    async function hydrateFromHistory() {
      try {
        const res = await fetch(`/api/jobs/${jobId}/history`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.events || cancelled) return;
        let out = "";
        let err = "";
        let finalState: typeof state = state;
        let finalExitCode: number | null = exitCode;
        let finalDuration: number | null = durationMs;
        let finalError = error;

        for (const event of data.events) {
          const payload = event.payload || {};
          if (payload.stream === "stdout" && typeof payload.text === "string") out += payload.text;
          if (payload.stream === "stderr" && typeof payload.text === "string") err += payload.text;
          if (payload.type === "result") {
            finalState = payload.state || finalState;
            if (typeof payload.exitCode === "number") finalExitCode = payload.exitCode;
            if (typeof payload.durationMs === "number") finalDuration = payload.durationMs;
            if (typeof payload.error === "string") finalError = payload.error;
          }
        }
        if (cancelled) return;
        if (out) setStdout(out);
        if (err) setStderr(err);
        setState(finalState);
        setExitCode(finalExitCode);
        setDurationMs(finalDuration);
        setError(finalError);
      } catch {
        // Ignore history fetch failure
      }
    }

    hydrateFromHistory();
    return () => {
      cancelled = true;
    };
  }, [expanded, durationMs, error, exitCode, finished, jobId, state, stderr, stdout]);

  const statusLabel = useMemo(() => {
    if (state === "running") return "Running";
    if (state === "succeeded") return "Succeeded";
    if (state === "timeout") return "Timed out";
    if (state === "stopped") return "Stopped";
    return "Failed";
  }, [state]);

  const statusClassName = useMemo(() => {
    if (state === "running") return `${styles.status} ${styles.statusRunning}`;
    if (state === "succeeded") return styles.status;
    return `${styles.status} ${styles.statusFailed}`;
  }, [state]);

  return (
    <div className={styles.card}>
      <button
        type="button"
        onClick={() => {
          userToggledRef.current = true;
          setExpanded((v) => !v);
        }}
        className={`${styles.header} ${expanded ? styles.headerExpanded : ""}`}
      >
        <div className={styles.left}>
          <span className={styles.chevron}>{expanded ? "▼" : "▶"}</span>
          {isRunApp ? (
            <>
              <span className={styles.name}>🚀 {appName}</span>
              {appArgs && <span className={styles.preview}>{appArgs}</span>}
            </>
          ) : (
            <>
              <span className={styles.name}>{toolName}</span>
              {commandPreview && <span className={styles.preview} title={command}>{commandPreview}</span>}
            </>
          )}
        </div>
        {isRunApp ? (
          <span className={`${styles.statusIcon} ${state !== "running" && state !== "succeeded" ? styles.statusIconFailed : ""}`}>
            {state === "running" ? "⋯" : state === "succeeded" ? "✓" : "✗"}
          </span>
        ) : (
          <div className={statusClassName}>{statusLabel}</div>
        )}
      </button>
      {expanded && (
        <>
          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.argsToggle}
              onClick={() => setShowArgs((v) => !v)}
            >
              {showArgs ? "Hide Args" : "Show Args"}
            </button>
          </div>
          {showArgs && (
            <div className={styles.argsBody}>
              {isRunApp ? (
                <pre className={styles.argsCode}>{`App: ${appName}\nArgs: ${appArgs || '(none)'}`}</pre>
              ) : (
                <pre className={styles.argsCode}>{command}</pre>
              )}
            </div>
          )}
          <div ref={bodyRef} className={styles.body}>
            {stdout && <div className={styles.stdout}>{stdout}</div>}
            {stderr && <div className={styles.stderr}>{stderr}</div>}
            {!stdout && !stderr && <div className={styles.empty}>No output yet.</div>}
          </div>
          <div className={styles.meta}>
            {exitCode !== null && <span>exit: {exitCode}</span>}
            {durationMs !== null && <span>duration: {durationMs}ms</span>}
            {error && <span className={styles.metaError}>{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
