/**
 * Engine data registry.
 *
 * Upstream uma-skill-tools imports `course_data.json` and `skill_data.json`
 * directly. Here the tables are injected at start-up from the app's normalized
 * GameTora data (see src/engine/adapters.ts), so the vendored sources stay
 * data-free and the daily data refresh keeps working.
 */
import type { CourseData } from './CourseData';

export interface EngineSkillEffect {
  type: number;
  modifier: number;
  /** uma-skill-tools SkillTarget id: 1 = self, 2 = everyone, other values = other runners. */
  target: number;
  /** Modifier-scaling mode (1 = fixed); see RaceSolver.getScaledModifier. */
  scaling: number;
}

export interface EngineSkillAlternative {
  precondition: string;
  condition: string;
  /** Seconds x 10000, as stored in the game data. */
  baseDuration: number;
  /** Duration-scaling mode (1 = fixed); see RaceSolver.getScaledDuration. */
  durationScaling: number;
  effects: EngineSkillEffect[];
}

export interface EngineSkill {
  /** Game rarity: 1 white, 2 gold, 3-5 unique variants, 6 evolution. */
  rarity: number;
  /** Whether the Wit activation roll applies to this skill. */
  wisdomCheck: number;
  /** Numeric game tag ids; the 600-699 group feeds one scaling rule. */
  tags: number[];
  alternatives: EngineSkillAlternative[];
}

export const courses: Record<string, CourseData> = Object.create(null);
export const skills: Record<string, EngineSkill> = Object.create(null);

export function registerCourses(table: Record<string, CourseData>): void {
  for (const k of Object.keys(courses)) delete courses[k];
  Object.assign(courses, table);
}

export function registerSkills(table: Record<string, EngineSkill>): void {
  for (const k of Object.keys(skills)) delete skills[k];
  Object.assign(skills, table);
}
