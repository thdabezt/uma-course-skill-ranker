/// <reference lib="webworker" />

import { skillsById } from '@/data';
import { analyzeSkill, createAnalysisContext, type AnalysisContext } from '@/analysis/skillAnalysis';
import { computeStamina, staminaSweep } from '@/analysis/stamina';
import type { AnalyzeRequest, AnalysisRow, StaminaRequest, WorkerRequest, WorkerResponse } from './analysisProtocol';

/**
 * Analyses a subset of skills off the main thread.
 *
 * The skill and course data is imported here rather than posted in: the
 * normalized JSON is already a bundled chunk that the page has loaded, so the
 * worker fetch hits cache. Sharding is sound because every skill is analysed by
 * an independent paired simulation seeded from the same master seed.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Rebuilt only when the race setup, runner or options change. */
let cached: { key: string; context: AnalysisContext } | null = null;

const contextKey = (msg: AnalyzeRequest): string =>
  JSON.stringify([msg.setup.course.id, msg.setup.runningStyle, msg.setup.trackCondition, msg.setup.weather, msg.setup.season, msg.runner, msg.options, msg.seed]);

function contextFor(msg: AnalyzeRequest): AnalysisContext {
  const key = contextKey(msg);
  if (cached && cached.key === key) return cached.context;
  cached = { key, context: createAnalysisContext(msg.setup, msg.runner, msg.options, msg.seed) };
  return cached.context;
}

function handle(msg: AnalyzeRequest): void {
  const context = contextFor(msg);
  const rows: AnalysisRow[] = [];
  for (const id of msg.skillIds) {
    const skill = skillsById.get(id);
    if (!skill) continue;
    rows.push({ skillId: id, analysis: analyzeSkill(context, skill, msg.samples) });
  }
  const response: WorkerResponse = { type: 'batch', jobId: msg.jobId, rows };
  ctx.postMessage(response);
}

function handleStamina(msg: StaminaRequest): void {
  const result = computeStamina(msg.input);
  const sweep = msg.sweep.length ? staminaSweep(msg.input, msg.sweep) : [];
  const response: WorkerResponse = { type: 'stamina', jobId: msg.jobId, result, sweep };
  ctx.postMessage(response);
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (!msg) return;
  try {
    if (msg.type === 'analyze') handle(msg);
    else if (msg.type === 'stamina') handleStamina(msg);
  } catch (e) {
    const response: WorkerResponse = {
      type: 'error',
      jobId: msg.jobId,
      message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
    };
    ctx.postMessage(response);
  }
});
