'use client';

import type { SimulationOptions } from '@/engine/compare';
import type { RaceSetup, RunnerStats } from '@/simulation/types';
import type { StaminaInput, StaminaResult } from '@/analysis/stamina';
import type { AnalyzeRequest, AnalysisRow, StaminaRequest, WorkerResponse } from './analysisProtocol';

/**
 * A pool of analysis workers with a dynamic work queue.
 *
 * Per-skill cost varies (a skill that never fires is free, a random one runs the
 * full sample count), so the pool keeps a cursor over the skill ids and hands
 * each idle worker a small batch, refilling as batches come back.
 */

const BATCH_SIZE = 6;

function poolSize(): number {
  const cores = typeof navigator === 'undefined' ? 4 : (navigator.hardwareConcurrency ?? 4);
  return Math.min(6, Math.max(2, cores - 1));
}

export const workersSupported = (): boolean => typeof Worker !== 'undefined';

export interface AnalysisJob {
  setup: RaceSetup;
  runner: RunnerStats;
  options: SimulationOptions;
  seed: [number, number];
  skillIds: number[];
  samples: number;
  onProgress?: (done: number, total: number) => void;
  /** Called with every batch as it lands, so a table can fill in progressively. */
  onRows?: (rows: AnalysisRow[]) => void;
}

interface Pending {
  jobId: number;
  job: AnalysisJob;
  resolve: (rows: AnalysisRow[]) => void;
  reject: (e: Error) => void;
  cursor: number;
  outstanding: number;
  rows: AnalysisRow[];
}

export interface StaminaOutcome {
  result: StaminaResult;
  sweep: { stamina: number; fullSpurtRate: number; remainingHpMedian: number }[];
}

interface PendingStamina {
  jobId: number;
  resolve: (r: StaminaOutcome) => void;
  reject: (e: Error) => void;
}

export class AnalysisPool {
  private workers: Worker[] = [];
  /** Dedicated worker so a stamina job never queues behind the skill batches. */
  private staminaWorker: Worker | null = null;
  private nextJobId = 1;
  private current: Pending | null = null;
  private stamina: PendingStamina | null = null;

  private makeWorker(): Worker {
    // Must be this exact literal form: the bundler statically rewrites it.
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url));
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => this.onMessage(worker, event.data));
    worker.addEventListener('error', (event) => {
      const err = new Error(event.message || 'analysis worker crashed');
      if (worker === this.staminaWorker) {
        const s = this.stamina;
        this.stamina = null;
        s?.reject(err);
      } else if (this.current) {
        this.fail(err);
      }
    });
    return worker;
  }

  private spawn(): void {
    if (this.workers.length) return;
    const size = poolSize();
    for (let i = 0; i < size; i += 1) this.workers.push(this.makeWorker());
    this.staminaWorker = this.makeWorker();
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.staminaWorker?.terminate();
    this.staminaWorker = null;
    if (this.current) this.fail(new Error('superseded'));
    if (this.stamina) {
      this.stamina.reject(new Error('superseded'));
      this.stamina = null;
    }
  }

  /** Starts a job; a job still running is abandoned (its promise rejects with 'superseded'). */
  run(job: AnalysisJob): Promise<AnalysisRow[]> {
    this.spawn();
    if (this.current) this.fail(new Error('superseded'));
    return new Promise<AnalysisRow[]>((resolve, reject) => {
      const pending: Pending = {
        jobId: this.nextJobId++,
        job,
        resolve,
        reject,
        cursor: 0,
        outstanding: 0,
        rows: [],
      };
      this.current = pending;
      if (!job.skillIds.length) {
        this.current = null;
        resolve([]);
        return;
      }
      for (const w of this.workers) this.feed(w);
    });
  }

  /** Runs one stamina calculation on the last worker (kept out of the skill queue). */
  runStamina(input: StaminaInput, sweep: number[]): Promise<StaminaOutcome> {
    this.spawn();
    if (this.stamina) {
      this.stamina.reject(new Error('superseded'));
      this.stamina = null;
    }
    return new Promise<StaminaOutcome>((resolve, reject) => {
      const jobId = this.nextJobId++;
      this.stamina = { jobId, resolve, reject };
      const msg: StaminaRequest = { type: 'stamina', jobId, input, sweep };
      this.staminaWorker!.postMessage(msg);
    });
  }

  private feed(worker: Worker): void {
    const p = this.current;
    if (!p || p.cursor >= p.job.skillIds.length) return;
    const ids = p.job.skillIds.slice(p.cursor, p.cursor + BATCH_SIZE);
    p.cursor += ids.length;
    p.outstanding += 1;
    const msg: AnalyzeRequest = {
      type: 'analyze',
      jobId: p.jobId,
      setup: p.job.setup,
      runner: p.job.runner,
      options: p.job.options,
      seed: p.job.seed,
      skillIds: ids,
      samples: p.job.samples,
    };
    worker.postMessage(msg);
  }

  private onMessage(worker: Worker, msg: WorkerResponse): void {
    if (msg.type === 'stamina') {
      if (this.stamina && this.stamina.jobId === msg.jobId) {
        const s = this.stamina;
        this.stamina = null;
        s.resolve({ result: msg.result, sweep: msg.sweep });
      }
      return;
    }
    if (msg.type === 'error' && this.stamina && this.stamina.jobId === msg.jobId) {
      const s = this.stamina;
      this.stamina = null;
      s.reject(new Error(msg.message));
      return;
    }
    const p = this.current;
    if (!p || msg.jobId !== p.jobId) return;
    if (msg.type === 'error') {
      this.fail(new Error(msg.message));
      return;
    }
    p.outstanding -= 1;
    p.rows.push(...msg.rows);
    p.job.onRows?.(msg.rows);
    p.job.onProgress?.(p.rows.length, p.job.skillIds.length);
    if (p.cursor < p.job.skillIds.length) {
      this.feed(worker);
    } else if (p.outstanding === 0) {
      this.current = null;
      p.resolve(p.rows);
    }
  }

  private fail(e: Error): void {
    const p = this.current;
    this.current = null;
    p?.reject(e);
  }
}
