import type { SimulationOptions } from '@/engine/compare';
import type { SkillAnalysis } from '@/analysis/skillAnalysis';
import type { StaminaInput, StaminaResult } from '@/analysis/stamina';
import type { RaceSetup, RunnerStats } from '@/simulation/types';

/**
 * Wire format between the page and the analysis workers. Everything is posted
 * structured-cloned; `SkillAnalysis` is plain data (no Maps, no functions).
 */

export interface AnalyzeRequest {
  type: 'analyze';
  jobId: number;
  setup: RaceSetup;
  runner: RunnerStats;
  options: SimulationOptions;
  seed: [number, number];
  skillIds: number[];
  samples: number;
}

export interface StaminaRequest {
  type: 'stamina';
  jobId: number;
  input: StaminaInput;
  /** Stamina values for the sensitivity sweep. */
  sweep: number[];
}

export type WorkerRequest = AnalyzeRequest | StaminaRequest;

export interface AnalysisRow {
  skillId: number;
  analysis: SkillAnalysis;
}

export interface BatchDone {
  type: 'batch';
  jobId: number;
  rows: AnalysisRow[];
}

export interface WorkerError {
  type: 'error';
  jobId: number;
  message: string;
}

export interface StaminaDone {
  type: 'stamina';
  jobId: number;
  result: StaminaResult;
  sweep: { stamina: number; fullSpurtRate: number; remainingHpMedian: number }[];
}

export type WorkerResponse = BatchDone | StaminaDone | WorkerError;
