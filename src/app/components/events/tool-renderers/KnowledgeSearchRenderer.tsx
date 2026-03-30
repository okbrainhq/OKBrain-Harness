"use client";

import { useState } from 'react';
import { BookOpen, MessageSquare, FileSearch, Check, X } from 'lucide-react';
import type { ToolRendererProps } from './index';
import styles from './SearchRenderer.module.css';

const TOOL_CONFIG: Record<string, { label: string; icon: typeof BookOpen }> = {
  search_facts: { label: 'Searching facts', icon: BookOpen },
  search_conversations: { label: 'Searching conversations', icon: MessageSquare },
  search_conversation: { label: 'Searching in conversation', icon: FileSearch },
};

export default function KnowledgeSearchRenderer({ toolName, callContent, resultContent, state }: ToolRendererProps) {
  const [expanded, setExpanded] = useState(false);
  const config = TOOL_CONFIG[toolName] || { label: 'Searching', icon: BookOpen };
  const Icon = config.icon;

  // Fallback: callContent.queries (new events) or callContent.arguments.query (old events)
  const queries: string[] = callContent?.queries ||
    (callContent?.arguments?.query ? [callContent.arguments.query] : []);
  const resultCount: number | undefined = resultContent?.result_count;
  const items: string[] = resultContent?.items || [];
  const conversationTitle: string | undefined = resultContent?.conversation_title;
  const isDone = state === 'succeeded' || state === 'failed' || state === 'stopped' || state === 'timeout';
  const hasFailed = state === 'failed';

  const iconState = isDone ? (hasFailed ? 'failed' : 'succeeded') : 'running';

  let resultSuffix = '';
  if (isDone && !hasFailed && resultCount !== undefined) {
    resultSuffix = resultCount === 0 ? ' · no results' : ` · ${resultCount} found`;
  }

  // For search_conversation, show the conversation title if available
  const label = toolName === 'search_conversation' && conversationTitle
    ? `Searching "${conversationTitle}"`
    : config.label;

  const hasExpandable = isDone && items.length > 0;

  return (
    <>
      <div
        className={styles.searchCard}
        style={{ cursor: hasExpandable ? 'pointer' : 'default' }}
        onClick={() => hasExpandable && setExpanded(!expanded)}
      >
        <span className={`${styles.searchIcon} ${styles[iconState]}`}>
          {isDone ? (
            hasFailed ? <X size={14} strokeWidth={2.5} /> : <Check size={14} strokeWidth={2.5} />
          ) : (
            <Icon size={14} />
          )}
        </span>
        <span className={styles.searchQueries}>
          <span className={styles.queryText}>
            {label} for {queries.map((q, i) => (
              <span key={i}>{i > 0 ? ', ' : ''}&ldquo;{q}&rdquo;</span>
            ))}
            {queries.length === 0 && '...'}
            {resultSuffix && <span style={{ fontWeight: 400, opacity: 0.7 }}>{resultSuffix}</span>}
          </span>
        </span>
        {hasExpandable && (
          <span className={styles.expandArrow}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>
      {expanded && items.length > 0 && (
        <div className={styles.resultsPanel}>
          {items.map((item, idx) => (
            <div key={idx} className={styles.resultItem} style={{ cursor: 'default' }}>
              {item}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
