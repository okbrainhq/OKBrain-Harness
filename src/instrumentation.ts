export async function register() {
  // Validate required env vars before anything else
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const required = ['JWT_SECRET', 'GOOGLE_API_KEY'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      console.error('\n\x1b[31m' + '='.repeat(60));
      console.error('  Missing required environment variables:');
      console.error('');
      for (const key of missing) {
        console.error(`    - ${key}`);
      }
      console.error('');
      console.error('  Add them to your .env.local file and restart.');
      console.error('='.repeat(60) + '\x1b[0m\n');
      process.exit(1);
    }
  }

  // Only run workers on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Import worker files - they register themselves on import
    await import('./workers/test-worker');
    await import('./workers/highlights-worker');
    await import('./workers/chat-worker');
    await import('./workers/chat-yield-scheduler-worker');
    await import('./workers/shell-command-worker');
    await import('./workers/run-app-worker');
    await import('./workers/summarize-worker');
    await import('./workers/fact-extraction-worker');
    await import('./workers/fact-sheet-rebuild-worker');

    // Start all registered workers (cleanup stale jobs first)
    const { startWorkers } = await import('./lib/jobs/workers');
    await startWorkers();

    // Start periodic triggers (skip in test mode)
    if (!process.env.TEST_MODE) {
      const { startPeriodicFactExtraction } = await import('./lib/periodic/fact-extraction');
      startPeriodicFactExtraction();

      const { startPeriodicFactSheetRebuild } = await import('./lib/periodic/fact-sheet-rebuild');
      startPeriodicFactSheetRebuild();
    }
  }
}
