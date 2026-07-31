import { courses, skills } from '@/data';
import { DEFAULT_RUNNER, type RunningStyle } from '@/simulation/config';
import type { Course, RaceSetup, RunnerStats, Skill } from '@/simulation/types';

/**
 * Manually verified example courses. Values cross-checked against
 * https://gametora.com/umamusume/racetracks.
 */
export const EXAMPLE_COURSES = {
  /** Japan Derby / Japan Cup layout. Left-handed, long home straight, one uphill. */
  tokyoTurf2400: findCourse('Tokyo', 'turf', 2400),
  /** Arima Kinen layout. Right-handed, famously steep uphill, short home straight. */
  nakayamaTurf2500: findCourse('Nakayama', 'turf', 2500),
  /** Takamatsunomiya Kinen layout. Sprint distance. */
  chukyoTurf1200: findCourse('Chukyo', 'turf', 1200),
  /** Boundary case: 1400 m is Sprint, although GameTora's own enum says Mile. */
  tokyoTurf1400: findCourse('Tokyo', 'turf', 1400),
  /** Yasuda Kinen layout. */
  tokyoTurf1600: findCourse('Tokyo', 'turf', 1600),
  /** Tenno Sho (Autumn) layout. */
  tokyoTurf2000: findCourse('Tokyo', 'turf', 2000),
  /** Boundary case: 2500 m is Long. */
  tokyoTurf2500: findCourse('Tokyo', 'turf', 2500),
  /** Tokyo Daishoten layout on a local dirt racecourse. */
  ooiDirt2000: findCourse('Ooi', 'dirt', 2000),
};

function findCourse(track: string, surface: 'turf' | 'dirt', distance: number): Course {
  const c = courses.find((x) => x.trackName === track && x.surface === surface && x.distance === distance);
  if (!c) throw new Error(`example course not found: ${track} ${surface} ${distance}`);
  return c;
}

/**
 * A unique skill and its inheritable copy share a display name, so a rarity has to
 * be given to pick between them.
 */
export function findSkill(name: string, rarity?: Skill['rarity']): Skill {
  const matches = skills.filter((x) => x.name === name && (!rarity || x.rarity === rarity));
  const s = rarity ? matches[0] : matches.find((x) => !x.isInheritedUnique) ?? matches[0];
  if (!s) throw new Error(`skill not found in the Global data set: ${name}${rarity ? ` (${rarity})` : ''}`);
  return s;
}

export function setupFor(course: Course, runningStyle: RunningStyle = 'pace_chaser'): RaceSetup {
  return { course, runningStyle, trackCondition: 'firm', weather: 'sunny', season: 'spring' };
}

export function runnerFor(runningStyle: RunningStyle = 'pace_chaser', overrides: Partial<RunnerStats> = {}): RunnerStats {
  return { ...DEFAULT_RUNNER, runningStyle, ...overrides };
}
