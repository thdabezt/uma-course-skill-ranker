import type { Skill } from '@/simulation/types';
import type { TransportSkillEvaluation } from '@/ranking/transport';
import type { RaceSetup, RunnerStats } from '@/simulation/types';

export { stripPredicates } from '@/ranking/transport';
export type {
  TransportActivationAnalysis,
  TransportClauseAnalysis,
  TransportEventTerm,
  TransportGroupEvaluation,
  TransportSkillEvaluation,
} from '@/ranking/transport';

/**
 * Wire format between the page and the ranking workers.
 *
 * Everything here is posted structured-cloned, never JSON. 97 Global skills have a
 * condition group with `durationSeconds === Infinity`; `JSON.stringify` turns every
 * one of them into `null`, which the details panel would render as "null s duration".
 */

/** A ranked row as it crosses the wire: the skill is re-attached by id on the page. */
export interface TransportRow {
  skillId: number;
  evaluation: TransportSkillEvaluation;
}

/** A ranked skill once the page has re-attached the skill record. */
export interface RankedSkillView {
  skill: Skill;
  evaluation: TransportSkillEvaluation;
}

export interface RankRequest {
  type: 'rank';
  jobId: number;
  setup: RaceSetup;
  runner: RunnerStats;
  /** Indices into the shared `skills` array. The worker imports the data itself. */
  indices: number[];
}

export type WorkerRequest = RankRequest;

export interface BatchDone {
  type: 'batch';
  jobId: number;
  rows: TransportRow[];
  /** Present on the first batch a worker sends for a given race setup. */
  baseline?: { finishTimeSeconds: number };
}

export interface WorkerError {
  type: 'error';
  jobId: number;
  message: string;
}

export type WorkerResponse = BatchDone | WorkerError;
