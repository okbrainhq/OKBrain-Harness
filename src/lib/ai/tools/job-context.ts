import { AsyncLocalStorage } from 'async_hooks';
import { WorkerContext } from '../../jobs';

interface ParentJobContext {
  ctx: WorkerContext;
  jobId: string;
  jobInput: any;
  signal?: AbortSignal;
  flushEventBuffers?: () => Promise<void>;
  emitEventPersisted?: (evt: { id: string; seq: number; kind: string; content: string; created_at: string }) => Promise<void>;
}

const parentJobStorage = new AsyncLocalStorage<ParentJobContext>();

export function runWithParentJobContext<T>(
  ctx: WorkerContext,
  jobId: string,
  jobInput: any,
  signal: AbortSignal | undefined,
  fn: () => T,
  flushEventBuffers?: () => Promise<void>,
  emitEventPersisted?: (evt: { id: string; seq: number; kind: string; content: string; created_at: string }) => Promise<void>
): T {
  return parentJobStorage.run({ ctx, jobId, jobInput, signal, flushEventBuffers, emitEventPersisted }, fn);
}

export function getParentJobContext(): ParentJobContext | undefined {
  return parentJobStorage.getStore();
}
