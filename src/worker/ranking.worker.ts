/// <reference lib="webworker" />

import { skills } from '@/data';
import { blockedEvaluation, tagRestrictionBlockers } from '@/ranking/rankSkills';
import { createBaseline, evaluateSkill, type BaselineContext } from '@/ranking/skillEvaluation';
import type { RaceSetup, RunnerStats } from '@/simulation/types';
import {
  stripPredicates,
  type RankRequest,
  type TransportRow,
  type WorkerResponse,
} from './rankingProtocol';

/**
 * Ranks a subset of the Global skills off the main thread.
 *
 * The skill data is imported here rather than posted in: the normalized JSON is
 * already a bundled chunk that the page has loaded, so the worker's `importScripts`
 * hits cache, and parsing it costs a few milliseconds - far less than cloning an
 * 800 kB array per job.
 *
 * Sharding is sound because a skill's evaluation depends only on the shared baseline,
 * which is a pure function of `(setup, runner)` with a fixed seed. `tests/rankingDigest.test.ts`
 * asserts that 8 shards reproduce the single-threaded result exactly.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Rebuilt only when the race setup changes, then reused across every batch. */
let cached: { key: string; baseline: BaselineContext } | null = null;

const baselineKey = (setup: RaceSetup, runner: RunnerStats): string =>
  JSON.stringify([
    setup.course.id,
    setup.runningStyle,
    setup.trackCondition,
    setup.weather,
    setup.season,
    runner,
  ]);

function baselineFor(setup: RaceSetup, runner: RunnerStats): BaselineContext {
  const key = baselineKey(setup, runner);
  if (cached && cached.key === key) return cached.baseline;
  cached = { key, baseline: createBaseline(setup, runner) };
  return cached.baseline;
}

function handleRank(msg: RankRequest): void {
  const { jobId, setup, runner, indices } = msg;
  const first = !cached || cached.key !== baselineKey(setup, runner);
  const baseline = baselineFor(setup, runner);

  const rows: TransportRow[] = [];
  for (const index of indices) {
    const skill = skills[index];
    if (!skill) continue;
    const blockers = tagRestrictionBlockers(skill, setup, runner);
    const evaluation = blockers.length
      ? blockedEvaluation(skill, blockers, baseline)
      : evaluateSkill(baseline, skill);
    rows.push({ skillId: skill.id, evaluation: stripPredicates(evaluation) });
  }

  const response: WorkerResponse = {
    type: 'batch',
    jobId,
    rows,
    ...(first ? { baseline: { finishTimeSeconds: baseline.baseline.finishTimeSeconds } } : {}),
  };
  ctx.postMessage(response);
}

ctx.addEventListener('message', (event: MessageEvent<RankRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'rank') return;
  try {
    handleRank(msg);
  } catch (e) {
    const response: WorkerResponse = {
      type: 'error',
      jobId: msg.jobId,
      message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
    };
    ctx.postMessage(response);
  }
});
