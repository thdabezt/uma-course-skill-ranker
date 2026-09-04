import { it } from 'vitest';

import { courses, skills } from '@/data';
import { analyzeSkill, createAnalysisContext } from '@/analysis/skillAnalysis';
import { selectAllAnalyzed } from '@/analysis/rankSkills';
import { DEFAULT_RUNNER } from '@/simulation/config';
import type { RaceSetup, RunnerStats } from '@/simulation/types';

const runner: RunnerStats = { ...DEFAULT_RUNNER, runningStyle: 'pace_chaser' };

it.skipIf(!process.env.SWEEP)('sweep zero-fire skills', () => {
  const targets = [10606, 10501];
  const all = selectAllAnalyzed(skills);
  const out: string[] = [];
  const byKey = new Map<string, Set<string>>();
  for (const id of targets) {
    const c = courses.find((x) => x.id === id)!;
    const setup: RaceSetup = { course: c, runningStyle: 'pace_chaser', trackCondition: 'firm', weather: 'sunny', season: 'spring' };
    const ctx = createAnalysisContext(setup, runner);
    const t0 = Date.now();
    for (const s of all) {
      const a = analyzeSkill(ctx, s, 12);
      const rate = a.activation?.rate ?? 0;
      if (a.reliability === 'never' || rate < 0.999 || a.error) {
        const conds = s.conditionGroups.map((g) => (g.precondition ? g.precondition + ' @ ' : '') + g.condition).join(' || ');
        out.push(
          `${c.name.padEnd(14)} ${a.reliability.padEnd(9)} rate ${(rate * 100).toFixed(0).padStart(3)}% ${s.rarity.padEnd(16)} ${s.name.padEnd(36)} ${a.error ? 'ERR ' + a.error : ''}| ${conds}`,
        );
        for (const part of conds.split(/[&@|]/)) {
          const m = /^\s*([a-z_0-9]+)/.exec(part);
          if (m) {
            if (!byKey.has(m[1])) byKey.set(m[1], new Set());
            byKey.get(m[1])!.add(s.name);
          }
        }
      }
    }
    console.log(`${c.name}: ${Date.now() - t0} ms for ${all.length} skills`);
  }
  console.log(out.sort().join('\n'));
  console.log('\nBY KEY');
  for (const [k, v] of [...byKey.entries()].sort((a, b) => b[1].size - a[1].size)) console.log(k.padEnd(40), v.size, [...v].slice(0, 6).join(' | '));
});
