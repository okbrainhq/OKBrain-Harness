"use client";

import React, { useState, useCallback } from "react";
import { Loader, Check } from "lucide-react";
import { getToolRenderer } from "./events/tool-renderers";
import "./events/tool-renderers/register";
import type { YieldedToolJob } from "@/hooks/useEventChatStreaming";
import styles from "./BackgroundTasksTab.module.css";

interface BackgroundTasksTabProps {
  jobs: YieldedToolJob[];
}

type JobState = 'running' | 'succeeded' | 'failed' | 'stopped' | 'timeout';

export default function BackgroundTasksTab({ jobs }: BackgroundTasksTabProps) {
  const [expanded, setExpanded] = useState(false);
  // Track state updates from renderers (overrides the initial state from props)
  const [stateOverrides, setStateOverrides] = useState<Record<string, JobState>>({});

  const handleStateChange = useCallback((jobId: string, newState: JobState) => {
    setStateOverrides(prev => {
      if (prev[jobId] === newState) return prev;
      return { ...prev, [jobId]: newState };
    });
  }, []);

  if (jobs.length === 0) return null;

  // Compute effective states
  const effectiveJobs = jobs.map(j => ({
    ...j,
    state: stateOverrides[j.toolJobId] || j.state,
  }));

  const runningJobs = effectiveJobs.filter(j => j.state === 'running');
  const runningCount = runningJobs.length;

  // Don't render anything if no jobs are running
  if (runningCount === 0) return null;

  const label = runningCount === 1
    ? "1 background task running"
    : `${runningCount} background tasks running`;
  const icon = <Loader size={12} className={styles.spinning} />;

  // Only render running jobs in the panel, but keep all renderers mounted (for SSE tracking)
  const hiddenRenderers = effectiveJobs.filter(j => j.state !== 'running').map((job) => {
    const Renderer = getToolRenderer(job.toolName);
    if (!Renderer) return null;
    return (
      <div key={job.toolJobId} className={styles.panelHidden}>
        <Renderer
          toolName={job.toolName}
          callContent={{ command: job.command }}
          state={job.state}
          asyncJobId={job.toolJobId}
          sinceSeq={job.sinceSeq}
          onStateChange={(newState) => handleStateChange(job.toolJobId, newState)}
        />
      </div>
    );
  });

  const visibleRenderers = runningJobs.map((job) => {
    const Renderer = getToolRenderer(job.toolName);
    if (Renderer) {
      return (
        <div key={job.toolJobId} className={styles.jobItem}>
          <Renderer
            toolName={job.toolName}
            callContent={{ command: job.command }}
            state={job.state}
            asyncJobId={job.toolJobId}
            sinceSeq={job.sinceSeq}
            onStateChange={(newState) => handleStateChange(job.toolJobId, newState)}
          />
        </div>
      );
    }

    return (
      <div key={job.toolJobId} className={styles.jobItem}>
        <div className={styles.fallbackCard}>
          <span className={styles.fallbackName}>{job.toolName}</span>
          <span className={styles.fallbackState}>{job.state}</span>
        </div>
      </div>
    );
  });

  return (
    <div className={`${styles.container} background-tasks-tab`}>
      {hiddenRenderers}
      <div className={`${styles.panel} ${expanded ? '' : styles.panelHidden}`}>
        <div className={styles.panelScroll}>
          {visibleRenderers}
        </div>
      </div>
      <div
        className={`${styles.toggle} background-tasks-toggle`}
        onClick={() => setExpanded((v) => !v)}
      >
        {icon}
        <span>{label}</span>
      </div>
    </div>
  );
}
