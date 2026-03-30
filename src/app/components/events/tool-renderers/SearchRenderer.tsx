"use client";

import { useState } from 'react';
import { Search, Check, X } from 'lucide-react';
import type { ToolRendererProps } from './index';
import styles from './SearchRenderer.module.css';

const TOOL_LABELS: Record<string, string> = {
  internet_search: 'Searching the web',
  internet_search_premium: 'Searching the web',
  news_search: 'Searching news',
};

export default function SearchRenderer({ toolName, callContent, resultContent, state }: ToolRendererProps) {
  const [expanded, setExpanded] = useState(false);

  const queries: string[] = callContent?.queries || [];
  const items: { title: string; url: string }[] = resultContent?.items || [];
  const label = TOOL_LABELS[toolName] || 'Searching';
  const isDone = state === 'succeeded' || state === 'failed' || state === 'stopped' || state === 'timeout';
  const hasFailed = state === 'failed';

  const iconState = isDone ? (hasFailed ? 'failed' : 'succeeded') : 'running';

  return (
    <>
      <div className={styles.searchCard} onClick={() => isDone && items.length > 0 && setExpanded(!expanded)}>
        <span className={`${styles.searchIcon} ${styles[iconState]}`}>
          {isDone ? (
            hasFailed ? <X size={14} strokeWidth={2.5} /> : <Check size={14} strokeWidth={2.5} />
          ) : (
            <Search size={14} />
          )}
        </span>
        <span className={styles.searchQueries}>
          <span className={styles.queryText}>
            {label} for {queries.map((q, i) => (
              <span key={i}>{i > 0 ? ', ' : ''}&ldquo;{q}&rdquo;</span>
            ))}
            {queries.length === 0 && '...'}
          </span>
        </span>
        {isDone && items.length > 0 && (
          <span className={styles.expandArrow}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>
      {expanded && items.length > 0 && (
        <div className={styles.resultsPanel}>
          {items.map((item, idx) => {
            let domain = '';
            try { domain = new URL(item.url).hostname.replace('www.', ''); } catch { }
            return (
              <a
                key={idx}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.resultItem}
              >
                {item.title}
                {domain && <span className={styles.resultDomain}>{domain}</span>}
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
