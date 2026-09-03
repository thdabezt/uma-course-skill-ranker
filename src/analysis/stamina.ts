/**
 * Stamina tab calculations on top of the ported umalator stamina calculator.
 */
import '@/engine';
import { toEngineCourse } from '@/engine/adapters';
import type { SkillEntry } from '@/engine/compare';
import { hpSummary, runHpCalc, staminaForSpurtRate, type HpCalcOptions, type HpCalcResult } from '@/engine/hpcalc';
import { STRATEGY_NAME, toHorseDesc, toRaceDefinition } from '@/engine/runner';
import type { RaceSetup, RunnerStats } from '@/simulation/types';
import { DEFAULT_SEED } from './skillAnalysis';

export interface StaminaInput {
  setup: RaceSetup;
  runner: RunnerStats;
  options: HpCalcOptions;
  /** Skills the runner carries into the race (recovery skills matter most). */
  skills: SkillEntry[];
  samples: number;
  seed?: [number, number];
}

export interface HpFigures {
  min: number;
  max: number;
  mean: number;
  median: number;
}

export interface StaminaResult {
  samples: number;
  maxHp: number;
  remainingHp: HpFigures;
  requiredHp: HpFigures;
  downhillSave: HpFigures;
  /** Share of runs that passed the game's full-spurt check. */
  fullSpurtRate: number;
  /** Effective stamina needed for the given full-spurt rates (keys are percentages). */
  staminaFor: Record<number, number>;
  /** Share of runs in which the runner rushed, and the HP it cost on average. */
  rushed: { rate: number; meanHpCost: number };
  /** Share of runs in which the front runner fought for the lead, and its mean HP cost. */
  spotStruggle: { rate: number; meanHpCost: number } | null;
  /** What each optional mechanic changes (positive = more HP left without it). */
  whatIf: { label: string; fullSpurtRate: number; remainingHpMedian: number }[];
}

export const SPURT_RATE_TARGETS = [50, 80, 90, 95, 100];

function costOf(result: HpCalcResult, id: string): { rate: number; meanHpCost: number } {
  const withIt: number[] = [];
  const without: number[] = [];
  result.activations.forEach((rec, i) => {
    (rec.has(id) ? withIt : without).push(result.remainingHpUnsorted[i] ?? 0);
  });
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    rate: result.activations.length ? withIt.length / result.activations.length : 0,
    meanHpCost: without.length && withIt.length ? mean(without) - mean(withIt) : 0,
  };
}

export function computeStamina(input: StaminaInput): StaminaResult {
  const course = toEngineCourse(input.setup.course);
  const horse = toHorseDesc(input.runner);
  const racedef = toRaceDefinition(input.setup, input.runner);
  const seed = input.seed ?? DEFAULT_SEED;
  const strategy = STRATEGY_NAME[input.runner.runningStyle];
  const build = { horse, skills: input.skills };

  const main = runHpCalc(input.samples, course, racedef, build, seed, input.options);
  const staminaFor: Record<number, number> = {};
  for (const pct of SPURT_RATE_TARGETS) {
    staminaFor[pct] = Math.round(staminaForSpurtRate(main, strategy, course.distance, pct / 100));
  }

  const whatIf: StaminaResult['whatIf'] = [];
  const isFrontRunner = input.runner.runningStyle === 'front_runner';
  const variants: { label: string; options: HpCalcOptions }[] = [];
  if (input.options.usePosKeep && !isFrontRunner) variants.push({ label: 'Without position keep (pace down)', options: { ...input.options, usePosKeep: false } });
  if (input.options.useCompeteTop && isFrontRunner) variants.push({ label: 'Without spot struggle', options: { ...input.options, useCompeteTop: false } });
  if (!input.options.useIntChecks) variants.push({ label: 'With Wit activation checks', options: { ...input.options, useIntChecks: true } });
  for (const v of variants) {
    const r = runHpCalc(Math.max(40, Math.floor(input.samples / 2)), course, racedef, build, seed, v.options);
    whatIf.push({ label: v.label, fullSpurtRate: r.fullSpurtCount / r.samples, remainingHpMedian: hpSummary(r.remainingHp).median });
  }

  return {
    samples: input.samples,
    maxHp: main.maxHp,
    remainingHp: hpSummary(main.remainingHp),
    requiredHp: hpSummary(main.requiredHp),
    downhillSave: hpSummary(main.downhillSave),
    fullSpurtRate: main.fullSpurtCount / main.samples,
    staminaFor,
    rushed: costOf(main, 'kakari'),
    spotStruggle: isFrontRunner ? costOf(main, 'itidoriarasoi') : null,
    whatIf,
  };
}

/** Full-spurt rate as a function of stamina, for the sensitivity chart. */
export function staminaSweep(input: StaminaInput, staminaValues: number[], samples = 60): { stamina: number; fullSpurtRate: number; remainingHpMedian: number }[] {
  const course = toEngineCourse(input.setup.course);
  const racedef = toRaceDefinition(input.setup, input.runner);
  const seed = input.seed ?? DEFAULT_SEED;
  return staminaValues.map((stamina) => {
    const horse = toHorseDesc({ ...input.runner, stamina });
    const r = runHpCalc(samples, course, racedef, { horse, skills: input.skills }, seed, input.options);
    return { stamina, fullSpurtRate: r.fullSpurtCount / r.samples, remainingHpMedian: hpSummary(r.remainingHp).median };
  });
}
