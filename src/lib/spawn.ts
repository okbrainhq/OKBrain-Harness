// Wrapper to prevent Turbopack NFT from tracing child_process.spawn
// as a filesystem operation that includes the whole project.
// Uses createRequire to dynamically load child_process at runtime.
import { createRequire } from 'node:module';
import type { SpawnOptions, ChildProcessWithoutNullStreams } from 'node:child_process';

const dynamicRequire = createRequire('file:///');

export function spawn(command: string, args: string[], options?: SpawnOptions): ChildProcessWithoutNullStreams {
  return dynamicRequire('node:child_process').spawn(command, args, options);
}
