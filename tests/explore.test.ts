import { it } from 'vitest';

import { courses, skills } from '@/data';
import { analyzeSkill, createAnalysisContext } from '@/analysis/skillAnalysis';
import { DEFAULT_RUNNER } from '@/simulation/config';
import type { RaceSetup, RunnerStats } from '@/simulation/types';

const runner: RunnerStats = { ...DEFAULT_RUNNER, runningStyle: 'pace_chaser' };

it.skipIf(!process.env.EXPLORE)('explore', () => {
  for (const id of [10606, 10501]) {
    const c = courses.find((x) => x.id === id)!;
    const setup: RaceSetup = { course: c, runningStyle: 'pace_chaser', trackCondition: 'firm', weather: 'sunny', season: 'spring' };
    const ctx = createAnalysisContext(setup, runner);
    const accel = skills.filter((s) => s.effectKinds.includes('acceleration') && s.rarity !== 'unique' && s.rarity !== 'unique_upgraded');
    const rows: string[] = [];
    const t0 = Date.now();
    for (const s of accel) {
      const a = analyzeSkill(ctx, s, 24);
      rows.push(
        `${(a.accel?.verdict ?? '-').padEnd(14)} ${s.name.padEnd(28)} ${s.rarity.padEnd(16)} gain ${a.gain.mean.toFixed(2)} ref ${(a.accel?.referenceGain ?? 0).toFixed(2)} ratio ${(a.accel?.ratio ?? 0).toFixed(2)} rel ${a.reliability.padEnd(9)} start ${a.activation ? Math.round(a.activation.meanStart) : '-'} off ${a.timing.offsetFromPhase2 == null ? '-' : Math.round(a.timing.offsetFromPhase2)} | ${s.conditionGroups[0].condition}`,
      );
    }
    console.log(`\n=== ${c.name} (${Date.now() - t0} ms, ${accel.length} skills)\n` + rows.sort().join('\n'));
  }
  const c = courses.find((x) => x.id === 10606)!;
  const setup: RaceSetup = { course: c, runningStyle: 'pace_chaser', trackCondition: 'firm', weather: 'sunny', season: 'spring' };
  const ctx = createAnalysisContext(setup, runner);
  const speed = skills.filter((s) => s.category === 'speed' && (s.rarity === 'gold' || s.rarity === 'inherited_unique'));
  const rows: string[] = [];
  const t0 = Date.now();
  for (const s of speed.slice(0, 60)) {
    const a = analyzeSkill(ctx, s, 24);
    rows.push(
      `${a.speed?.tier ?? '-'} ${s.name.padEnd(30)} gain ${a.gain.mean.toFixed(2)} [${a.gain.min.toFixed(2)},${a.gain.max.toFixed(2)}] rel ${a.reliability.padEnd(9)} carry ${(a.timing.carryoverShare * 100).toFixed(0)}% shadow ${(a.timing.shadowShare * 100).toFixed(0)}% cut ${(a.timing.cutByFinishShare * 100).toFixed(0)}% hp ${a.timing.hpCost.toFixed(1)} | ${a.speed?.explanation}`,
    );
  }
  console.log(`\n=== SPEED ${c.name} (${Date.now() - t0} ms)\n` + rows.sort().reverse().join('\n'));
});
