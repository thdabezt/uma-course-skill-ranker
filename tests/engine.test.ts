import { describe, expect, it } from 'vitest';

import '@/engine';
import { courses, skills } from '@/data';
import { runComparison, summarize } from '@/engine/compare';
import { toEngineCourse } from '@/engine/adapters';
import { toHorseDesc, toRaceDefinition } from '@/engine/runner';
import { RaceSolverBuilder } from '@/engine/vendor/RaceSolverBuilder';
import { CourseHelpers } from '@/engine/vendor/CourseData';
import type { RaceSolver } from '@/engine/vendor/RaceSolver';
import { DEFAULT_RUNNER } from '@/simulation/config';
import type { RaceSetup, RunnerStats } from '@/simulation/types';
import { RACES } from './utoolsCalibration.data';

const course = (track: string, surface: 'turf' | 'dirt', distance: number) =>
  courses.find((c) => c.trackName === track && c.surface === surface && c.distance === distance)!;

const skillByName = (name: string, rarity?: string) =>
  skills.find((s) => s.name === name && (!rarity || s.rarity === rarity))!;

const runner: RunnerStats = { ...DEFAULT_RUNNER, runningStyle: 'pace_chaser' };
const OPTIONS = { usePosKeep: true, useCompeteTop: true, useIntChecks: false };

describe('vendored engine', () => {
  it('registers every Global course and runs a plain race to the finish', () => {
    const c = course('Tokyo', 'turf', 2400);
    const engineCourse = CourseHelpers.getCourse(c.id);
    expect(engineCourse.distance).toBe(2400);
    expect(engineCourse.corners.length).toBe(c.corners.length);

    const builder = new RaceSolverBuilder(1).seed(1234).course(engineCourse).horse(toHorseDesc(runner));
    const solver = builder.build().next().value as RaceSolver;
    let frames = 0;
    while (solver.pos < engineCourse.distance && frames < 15 * 300) {
      solver.step(1 / 15);
      frames += 1;
    }
    expect(solver.pos).toBeGreaterThanOrEqual(2400);
    // A 2400 m race takes roughly two minutes.
    expect(solver.accumulatetime.t).toBeGreaterThan(100);
    expect(solver.accumulatetime.t).toBeLessThan(150);
  });

  it('gives a target-speed skill a positive, reproducible paired gain', () => {
    const c = course('Tokyo', 'turf', 2400);
    const setup: RaceSetup = { course: c, runningStyle: 'pace_chaser', trackCondition: 'firm', weather: 'sunny', season: 'spring' };
    const horse = toHorseDesc(runner);
    const racedef = toRaceDefinition(setup, runner);
    const skill = skillByName('Neck and Neck');
    const run = () =>
      runComparison(
        20,
        toEngineCourse(c),
        racedef,
        { horse, skills: [] },
        { horse, skills: [{ id: String(skill.id) }] },
        [42, 7],
        OPTIONS,
      );
    const first = run();
    const second = run();
    expect(first.results).toEqual(second.results);
    expect(summarize(first.results).mean).toBeGreaterThan(0);
    expect(first.activations[1].every((rec) => rec.has(String(skill.id)))).toBe(true);
    expect(first.activations[0].every((rec) => !rec.has(String(skill.id)))).toBe(true);
  });
});

describe('calibration against umalator-global', () => {
  // Values recorded from umalator's Skill table (tests/utoolsCalibration.data.ts)
  // with the same runner and options. The engine is the same code, so the means
  // should agree well inside Monte Carlo noise.
  for (const race of RACES) {
    it(`reproduces ${race.race} within tolerance`, () => {
      const c = course(race.trackName, race.surface, race.distance);
      const setup: RaceSetup = { course: c, runningStyle: 'pace_chaser', trackCondition: 'firm', weather: 'sunny', season: 'spring' };
      const horse = toHorseDesc(runner);
      const racedef = toRaceDefinition(setup, runner);
      const rows: string[] = [];
      let close = 0;
      let total = 0;
      for (const [name, ref] of Object.entries(race.utools)) {
        const skill = skillByName(name, race.rarities?.[name]);
        if (!skill) continue;
        const res = runComparison(
          120,
          toEngineCourse(c),
          racedef,
          { horse, skills: [] },
          { horse, skills: [{ id: String(skill.id) }] },
          [2615953739, 0],
          OPTIONS,
        );
        const s = summarize(res.results);
        const tolerance = Math.max(0.35, 0.3 * Math.abs(ref.mean));
        const ok = Math.abs(s.mean - ref.mean) <= tolerance;
        total += 1;
        if (ok) close += 1;
        rows.push(`${ok ? 'ok ' : 'OFF'} ${name.padEnd(22)} local ${s.mean.toFixed(2)} [${s.min.toFixed(2)}, ${s.max.toFixed(2)}]  umalator ${ref.mean.toFixed(2)} [${ref.min.toFixed(2)}, ${ref.max.toFixed(2)}]`);
      }
      console.log(`CALIBRATION ${race.race}\n${rows.join('\n')}`);
      // Random-position skills can legitimately land a little further out; require most rows to agree.
      expect(close / total).toBeGreaterThanOrEqual(0.7);
    });
  }
});
