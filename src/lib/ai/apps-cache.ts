/**
 * Cached app data for system prompts.
 *
 * Two caches:
 * 1. App names — up to 10 app titles (used as fallback)
 * 2. App usage signatures — top 5 most common run_app patterns from last 7 days
 *
 * Both use sync read + async refresh pattern.
 */

import { getAppNames, getAppByTitle, getRecentRunAppCalls } from '../db';

const MAX_APPS = 10;
const MAX_SIGNATURES = 5;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// --- App names cache ---

interface AppNamesCacheEntry {
  apps: Array<{ id: string; title: string }>;
  expiresAt: number;
}

const namesCache = new Map<string, AppNamesCacheEntry>();

export function getCachedAppNamesSynced(userId: string): Array<{ id: string; title: string }> {
  const cached = namesCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.apps;
  return [];
}

export async function refreshAppNamesCache(userId: string): Promise<Array<{ id: string; title: string }>> {
  try {
    const apps = await getAppNames(userId, MAX_APPS);
    namesCache.set(userId, { apps, expiresAt: Date.now() + CACHE_TTL_MS });
    return apps;
  } catch {
    return [];
  }
}

export function appNamesCacheNeedsRefresh(userId: string): boolean {
  const cached = namesCache.get(userId);
  return !cached || Date.now() >= cached.expiresAt;
}

export function invalidateAppNamesCache(userId: string): void {
  namesCache.delete(userId);
}

// --- App usage signatures cache ---

export interface AppUsageSignature {
  appName: string;
  exampleArgs: string;
  count: number;
}

interface UsageCacheEntry {
  signatures: AppUsageSignature[];
  expiresAt: number;
}

const usageCache = new Map<string, UsageCacheEntry>();

export function getCachedAppUsagesSynced(userId: string): AppUsageSignature[] {
  const cached = usageCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.signatures;
  return [];
}

export function appUsageCacheNeedsRefresh(userId: string): boolean {
  const cached = usageCache.get(userId);
  return !cached || Date.now() >= cached.expiresAt;
}

/**
 * Build top 5 usage signatures from recent run_app calls.
 * Groups by (app_name, first_word_of_args), counts, picks a representative example.
 * Verifies each app still exists before including.
 */
export async function refreshAppUsageCache(userId: string): Promise<AppUsageSignature[]> {
  try {
    const calls = await getRecentRunAppCalls(userId, 7);

    // Group by (app_name, subcommand) — subcommand is the first word of args
    const groups = new Map<string, { appName: string; args: string[]; count: number }>();
    for (const c of calls) {
      const subcommand = c.args.trim().split(/\s+/)[0] || '';
      const key = `${c.app_name}\0${subcommand}`;
      const group = groups.get(key);
      if (group) {
        group.count++;
        // Keep the most recent args as example (calls are ordered DESC)
        if (group.args.length < 1) group.args.push(c.args);
      } else {
        groups.set(key, { appName: c.app_name, args: [c.args], count: 1 });
      }
    }

    // Sort by count descending, take top entries
    const sorted = [...groups.values()].sort((a, b) => b.count - a.count);

    // Verify each app still exists, collect up to 5
    const verified: AppUsageSignature[] = [];
    const checkedApps = new Map<string, boolean>();
    for (const entry of sorted) {
      if (verified.length >= MAX_SIGNATURES) break;

      // Check app existence (cache per app name within this refresh)
      if (!checkedApps.has(entry.appName)) {
        const app = await getAppByTitle(userId, entry.appName);
        checkedApps.set(entry.appName, !!app);
      }
      if (!checkedApps.get(entry.appName)) continue;

      verified.push({
        appName: entry.appName,
        exampleArgs: entry.args[0],
        count: entry.count,
      });
    }

    usageCache.set(userId, { signatures: verified, expiresAt: Date.now() + CACHE_TTL_MS });
    return verified;
  } catch {
    return [];
  }
}
