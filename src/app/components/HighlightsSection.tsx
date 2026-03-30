"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RefreshCw, Edit2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./primitive/Button";
import { useChatContext } from "../context/ChatContext";

// Time display with SSR support - uses suppressHydrationWarning to handle mismatch
function TimeAgo({ date }: { date: string }) {
  // Calculate initial value for SSR (will be slightly off but avoids flash)
  const getMinutes = () => Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  const [minutes, setMinutes] = useState(getMinutes);

  useEffect(() => {
    // Update immediately on mount to get accurate client time
    setMinutes(getMinutes());
    const interval = setInterval(() => setMinutes(getMinutes()), 60000);
    return () => clearInterval(interval);
  }, [date]);

  return <span suppressHydrationWarning>{minutes} min ago</span>;
}
import "./Markdown.module.css";
import "./primitive/ContentStyles.module.css";
import "./HighlightsSection.css";

type HighlightView = "today" | "tomorrow" | "week";

const VIEWS: HighlightView[] = ["today", "tomorrow", "week"];

const VIEW_LABELS: Record<HighlightView, string> = {
  today: "NEXT 24H",
  tomorrow: "NEXT 48H",
  week: "THIS WEEK",
};

const COOLDOWNS: Record<HighlightView, number> = {
  today: 60 * 60 * 1000,
  tomorrow: 6 * 60 * 60 * 1000,
  week: 6 * 60 * 60 * 1000,
};

interface ViewData {
  highlight: string | null;
  lastRunAt: string | null;
  jobId: string;
  jobState: string | null;
  isRunning: boolean;
}

export interface HighlightData {
  prompt: string;
  views: Record<string, ViewData>;
}

interface HighlightsSectionProps {
  initialData?: HighlightData | null;
}

const defaultViewData: ViewData = {
  highlight: null,
  lastRunAt: null,
  jobId: '',
  jobState: null,
  isRunning: false,
};

export default function HighlightsSection({ initialData }: HighlightsSectionProps) {
  const { location: locationContext } = useChatContext();
  const [prompt, setPrompt] = useState(initialData?.prompt || "");
  const [viewsData, setViewsData] = useState<Record<string, ViewData>>(
    initialData?.views || {
      today: { ...defaultViewData },
      tomorrow: { ...defaultViewData },
      week: { ...defaultViewData },
    }
  );
  const [activeView, setActiveView] = useState<HighlightView>("today");
  const [loadingViews, setLoadingViews] = useState<Set<HighlightView>>(new Set());
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editPrompt, setEditPrompt] = useState(prompt);
  const contentRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const eventSourcesRef = useRef<Record<string, EventSource>>({});

  const isLoading = loadingViews.has(activeView);

  const fetchAllData = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/highlights");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setPrompt(json.prompt);
      setEditPrompt(json.prompt);
      setViewsData(json.views);
      return json.views as Record<string, ViewData>;
    } catch (err) {
      setError("Failed to load");
      console.error(err);
      return null;
    }
  }, []);

  // Stream job events via SSE
  const streamJob = useCallback((view: HighlightView, jobId: string) => {
    // Close existing event source for this view if any
    if (eventSourcesRef.current[view]) {
      eventSourcesRef.current[view].close();
    }

    setLoadingViews(prev => new Set(prev).add(view));
    setStreamingText(prev => ({ ...prev, [view]: '' }));

    const eventSource = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/stream`);
    eventSourcesRef.current[view] = eventSource;

    let accumulatedText = '';

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.done) {
          eventSource.close();
          delete eventSourcesRef.current[view];
          setLoadingViews(prev => {
            const next = new Set(prev);
            next.delete(view);
            return next;
          });
          // Fetch final data to get the complete state
          fetchAllData();
          return;
        }

        if (data.kind === 'output' && data.payload?.text) {
          accumulatedText += data.payload.text;
          setStreamingText(prev => ({ ...prev, [view]: accumulatedText }));
        }
      } catch {
        // Skip invalid JSON
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      delete eventSourcesRef.current[view];
      setLoadingViews(prev => {
        const next = new Set(prev);
        next.delete(view);
        return next;
      });
      // Try to fetch final data anyway
      fetchAllData();
    };

    return () => {
      eventSource.close();
      delete eventSourcesRef.current[view];
    };
  }, [fetchAllData]);

  const triggerGeneration = useCallback(async (view: HighlightView, force = false) => {
    setLoadingViews(prev => new Set(prev).add(view));
    setStreamingText(prev => ({ ...prev, [view]: '' }));
    setError(null);

    try {
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          force,
          view,
          location: locationContext.location
            ? `${locationContext.location.lat},${locationContext.location.lng}`
            : undefined,
        }),
      });
      const json = await res.json();

      if (json.skipped) {
        // Cooldown active, just fetch current data
        setLoadingViews(prev => {
          const next = new Set(prev);
          next.delete(view);
          return next;
        });
        await fetchAllData();
        return;
      }

      if (json.jobId && (json.state === 'idle' || json.state === 'running' || json.message === 'Job already in progress')) {
        // Start streaming (job is queued or running)
        streamJob(view, json.jobId);
      } else {
        // Unexpected response
        setLoadingViews(prev => {
          const next = new Set(prev);
          next.delete(view);
          return next;
        });
      }
    } catch (err) {
      console.error(err);
      setError("Failed to generate");
      setLoadingViews(prev => {
        const next = new Set(prev);
        next.delete(view);
        return next;
      });
    }
  }, [fetchAllData, streamJob]);

  const savePrompt = async () => {
    try {
      const res = await fetch("/api/highlights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: editPrompt }),
      });
      if (res.ok) {
        setPrompt(editPrompt);
        setShowEdit(false);
        // Regenerate all views with the new prompt
        for (const view of VIEWS) {
          triggerGeneration(view, true);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const isViewStale = useCallback((view: HighlightView): boolean => {
    const vd = viewsData[view];
    if (!vd?.lastRunAt) return true;
    return Date.now() - new Date(vd.lastRunAt).getTime() >= COOLDOWNS[view];
  }, [viewsData]);

  // On mount: check for running jobs and stream them, or trigger stale views
  useEffect(() => {
    const initializeViews = async () => {
      let views = initialData?.views;

      if (!views) {
        const fetched = await fetchAllData();
        if (fetched) {
          views = fetched;
        }
      } else if (initialData) {
        setEditPrompt(initialData.prompt);
      }

      if (views) {
        // Check each view - if running, stream it; if stale, trigger generation
        for (const view of VIEWS) {
          const vd = views[view];
          if (vd?.isRunning && vd?.jobId) {
            // Job is already running, connect to stream
            streamJob(view, vd.jobId);
          } else {
            // Check if stale
            const stale = !vd?.lastRunAt || (Date.now() - new Date(vd.lastRunAt).getTime() >= COOLDOWNS[view]);
            if (stale) {
              triggerGeneration(view, false);
            }
          }
        }
      }
    };

    initializeViews();

    // Cleanup event sources on unmount
    return () => {
      Object.values(eventSourcesRef.current).forEach(es => es.close());
    };
  }, []);

  // Periodic refresh: check every hour for today, every 6h for others
  useEffect(() => {
    const interval = setInterval(() => {
      for (const view of VIEWS) {
        if (isViewStale(view) && !loadingViews.has(view)) {
          triggerGeneration(view, false);
        }
      }
    }, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isViewStale, triggerGeneration, loadingViews]);

  // Arrow navigation
  const prev = () => {
    const idx = VIEWS.indexOf(activeView);
    if (idx > 0) setActiveView(VIEWS[idx - 1]);
  };
  const next = () => {
    const idx = VIEWS.indexOf(activeView);
    if (idx < VIEWS.length - 1) setActiveView(VIEWS[idx + 1]);
  };

  // Swipe handlers
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      diff > 0 ? next() : prev();
    }
  };

  const current = viewsData[activeView] || defaultViewData;
  const activeIdx = VIEWS.indexOf(activeView);

  // Show streaming text if available, otherwise show saved highlight
  const displayText = streamingText[activeView] || current.highlight;

  if (!viewsData.today && !isLoading && !error) return null;

  return (
    <>
      <div className="highlights-section">
        {error && <div className="highlights-error">{error}</div>}

        <div className="highlights-nav">
          {activeIdx > 0 && (
            <button
              className="highlights-arrow"
              onClick={prev}
              aria-label="Previous"
            >
              <ChevronLeft size={14} />
            </button>
          )}

          <div className="highlights-title">{VIEW_LABELS[activeView]}</div>

          {activeIdx < VIEWS.length - 1 && (
            <button
              className="highlights-arrow"
              onClick={next}
              aria-label="Next"
            >
              <ChevronRight size={14} />
            </button>
          )}
        </div>

        <div
          className="highlights-content content-styles"
          ref={contentRef}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {displayText ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                ul: ({ ...props }) => <ul className="markdown-list" {...props} />,
                ol: ({ ...props }) => <ol className="markdown-list" {...props} />,
                li: ({ children, ...props }) => <li className="markdown-list-item" {...props}>{children}</li>,
                p: ({ ...props }) => <p className="markdown-paragraph" {...props} />,
                strong: ({ ...props }) => <strong className="markdown-strong" {...props} />,
                a: ({ children, ...props }) => (
                  <a
                    target="_blank"
                    rel="noopener noreferrer"
                    className="markdown-citation"
                    {...props}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {displayText}
            </ReactMarkdown>
          ) : (
            <span className="highlights-empty">
              {isLoading ? "Generating..." : "No highlights yet"}
            </span>
          )}
        </div>

        <div className="highlights-footer">
          <button className="highlight-action-btn" onClick={() => setShowEdit(true)} title="Edit">
            <Edit2 size={12} />
          </button>
          <button className="highlight-action-btn" onClick={() => triggerGeneration(activeView, true)} disabled={isLoading} title="Refresh">
            <RefreshCw size={12} className={isLoading ? "spin" : ""} />
          </button>
          {current.lastRunAt && (
            <span style={{ opacity: isLoading ? 0.5 : 1 }}>
              <TimeAgo date={current.lastRunAt} />
            </span>
          )}
        </div>
      </div>

      {showEdit && (
        <div className="highlight-edit-overlay" onClick={() => setShowEdit(false)}>
          <div className="highlight-edit-modal" onClick={e => e.stopPropagation()}>
            <h3>What do you want to see?</h3>
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="e.g. My meetings and tasks"
              rows={3}
            />
            <div className="highlight-edit-buttons">
              <Button onClick={() => setShowEdit(false)} fullWidth={false} variant="secondary">Cancel</Button>
              <Button onClick={savePrompt} fullWidth={false}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
