'use client';

import type { RaceSetup, RunnerStats } from '@/simulation/types';
import type { RankRequest, TransportRow, WorkerResponse } from './rankingProtocol';

/**
 * A pool of ranking workers with a dynamic work queue.
 *
 * Per-skill cost is heavily skewed - most skills are milliseconds, a handful are
 * hundreds - so static shards finish at wildly different times and the slowest one
 * sets the wall clock. Instead the pool keeps a cursor over the skill indices and
 * hands each idle worker a small batch, refilling as batches come back.
 *
 * Workers are spawned lazily on the first ranking, not on mount, so N of them do not
 * race to parse the data chunk on a cold cache.
 */

const BATCH_SIZE = 8;

/**
 * Capped well below the core count. Each worker keeps its own baseline pool - up to
 * `EVALUATION.maxRuns` opponent fields - so the pool trades memory for latency, and
 * past a handful of workers the extra memory buys very little wall-clock.
 */
function poolSize(): number {
  const cores = typeof navigator === 'undefined' ? 4 : (navigator.hardwareConcurrency ?? 4);
  return Math.min(6, Math.max(2, cores - 1));
}

export const workersSupported = (): boolean => typeof Worker !== 'undefined';

export interface RankingRun {
  rows: TransportRow[];
  baselineFinishTimeSeconds: number;
}

interface Pending {
  jobId: number;
  resolve: (r: RankingRun) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
  total: number;
  cursor: number;
  outstanding: number;
  rows: TransportRow[];
  baselineFinishTimeSeconds: number | null;
  setup: RaceSetup;
  runner: RunnerStats;
}

export class RankingPool {
  private workers: Worker[] = [];
  private nextJobId = 1;
  private current: Pending | null = null;

  private spawn(): void {
    if (this.workers.length) return;
    const size = poolSize();
    for (let i = 0; i < size; i += 1) {
      // Must be this exact literal form: the bundler statically rewrites it to the
      // emitted chunk URL, and that URL carries the deployed basePath. No
      // `{ type: 'module' }` - webpack emits a classic worker here.
      const worker = new Worker(new URL('./ranking.worker.ts', import.meta.url));
      worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) =>
        this.onMessage(worker, e.data),
      );
      worker.addEventListener('error', (e) => {
        this.current?.reject(new Error(e.message || 'ranking worker failed to start'));
      });
      this.workers.push(worker);
    }
  }

  private dispatch(worker: Worker, job: Pending): boolean {
    if (job.cursor >= job.total) return false;
    const indices: number[] = [];
    for (let i = 0; i < BATCH_SIZE && job.cursor < job.total; i += 1, job.cursor += 1) {
      indices.push(job.cursor);
    }
    job.outstanding += 1;
    const request: RankRequest = {
      type: 'rank',
      jobId: job.jobId,
      setup: job.setup,
      runner: job.runner,
      indices,
    };
    worker.postMessage(request);
    return true;
  }

  private onMessage(worker: Worker, msg: WorkerResponse): void {
    const job = this.current;
    // A superseded job's batches are dropped rather than terminating the worker,
    // which would throw away its warm baseline and its JIT state.
    if (!job || msg.jobId !== job.jobId) return;

    if (msg.type === 'error') {
      job.reject(new Error(msg.message));
      this.current = null;
      return;
    }

    job.outstanding -= 1;
    for (const row of msg.rows) job.rows.push(row);
    if (msg.baseline && job.baselineFinishTimeSeconds === null) {
      job.baselineFinishTimeSeconds = msg.baseline.finishTimeSeconds;
    }
    job.onProgress?.(job.rows.length, job.total);

    this.dispatch(worker, job);

    if (job.outstanding === 0 && job.cursor >= job.total) {
      if (job.baselineFinishTimeSeconds === null) {
        job.reject(new Error('the ranking workers returned no baseline'));
      } else {
        job.resolve({ rows: job.rows, baselineFinishTimeSeconds: job.baselineFinishTimeSeconds });
      }
      this.current = null;
    }
  }

  /** Ranks skill indices `[0, total)`. A new call supersedes any run in flight. */
  run(
    setup: RaceSetup,
    runner: RunnerStats,
    total: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<RankingRun> {
    this.spawn();
    // Abandon whatever was running; its messages will be ignored by job id.
    this.current?.reject(new Error('superseded'));

    return new Promise<RankingRun>((resolve, reject) => {
      const job: Pending = {
        jobId: this.nextJobId++,
        resolve,
        reject,
        onProgress,
        total,
        cursor: 0,
        outstanding: 0,
        rows: [],
        baselineFinishTimeSeconds: null,
        setup,
        runner,
      };
      this.current = job;
      if (total === 0) {
        resolve({ rows: [], baselineFinishTimeSeconds: 0 });
        this.current = null;
        return;
      }
      // Prime every worker; each refills itself as its batches complete.
      for (const worker of this.workers) {
        if (!this.dispatch(worker, job)) break;
      }
    });
  }

  /** Idempotent, so React StrictMode's double-invoked effects are safe. */
  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.current = null;
  }
}
