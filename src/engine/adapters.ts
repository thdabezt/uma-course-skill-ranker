/**
 * Bridges the app's normalized GameTora data and the vendored uma-skill-tools
 * engine. Both tables are derived from the same game master data, so the mapping
 * is a pure reshaping: no values are invented here.
 */
import type { Course, Skill } from '@/simulation/types';
import type { CourseData } from './vendor/CourseData';
import type { EngineSkill } from './vendor/data';

/** uma-skill-tools DistanceType: 1 short, 2 mile, 3 mid, 4 long. */
const DISTANCE_TYPE: Record<Course['distanceCategory'], 1 | 2 | 3 | 4> = {
  sprint: 1,
  mile: 2,
  medium: 3,
  long: 4,
};

/** uma-skill-tools Orientation: 1 clockwise (right), 2 counter-clockwise (left), 4 no turns. */
const ORIENTATION: Record<Course['direction'], 1 | 2 | 4> = { right: 1, left: 2, straight: 4 };

/** uma-skill-tools ThresholdStat ids. */
const THRESHOLD_STAT: Record<string, number> = { speed: 1, stamina: 2, power: 3, guts: 4, wit: 5 };

/**
 * Game rarity codes the engine expects: 1 white, 2 gold, 3-5 unique variants
 * (all treated as SkillRarity.Unique), 6 evolution. Inherited uniques are white
 * skills in the game data.
 */
const ENGINE_RARITY: Record<Skill['rarity'], number> = {
  normal: 1,
  gold: 2,
  unique: 3,
  unique_upgraded: 4,
  evolution: 6,
  inherited_unique: 1,
};

export function toEngineCourse(course: Course): CourseData {
  const slopes = [
    ...course.uphills.map((s) => ({ start: s.start, length: s.end - s.start, slope: Math.round(s.gradePercent * 10000) })),
    ...course.downhills.map((s) => ({ start: s.start, length: s.end - s.start, slope: -Math.round(s.gradePercent * 10000) })),
  ].sort((a, b) => a.start - b.start);

  return {
    raceTrackId: course.trackId,
    distance: course.distance,
    distanceType: DISTANCE_TYPE[course.distanceCategory],
    surface: course.surface === 'turf' ? 1 : 2,
    turn: ORIENTATION[course.direction],
    courseSetStatus: course.statThresholds.map((t) => THRESHOLD_STAT[t]).filter((n): n is number => n != null),
    corners: course.corners.map((c) => ({ start: c.start, length: c.end - c.start })),
    straights: course.straights.map((s) => ({ start: s.start, end: s.end, frontType: s.frontType })),
    slopes,
  };
}

export function toEngineSkill(skill: Skill): EngineSkill {
  return {
    rarity: ENGINE_RARITY[skill.rarity],
    wisdomCheck: skill.wisdomCheck ? 1 : 0,
    tags: skill.engineTags,
    alternatives: skill.conditionGroups.map((g) => ({
      precondition: g.precondition ?? '',
      condition: g.condition,
      // Game encoding: seconds x 10000, or -1 for a permanent effect.
      baseDuration: g.baseDurationSeconds === -1 ? -1 : Math.round(g.baseDurationSeconds * 10000),
      durationScaling: g.durationScaling,
      effects: g.effects.map((e) => ({ type: e.rawType, modifier: e.rawValue, target: e.target, scaling: e.scaling })),
    })),
  };
}
