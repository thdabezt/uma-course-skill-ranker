/**
 * Engine bootstrap: registers every Global course and skill with the vendored
 * uma-skill-tools engine and re-exports the pieces the app builds on.
 *
 * Importing this module anywhere (page, worker, tests) is enough; registration
 * is idempotent.
 */
import { courses, skills } from '@/data';
import { toEngineCourse, toEngineSkill } from './adapters';
import { registerCourses, registerSkills } from './vendor/data';

let registered = false;

export function ensureEngineData(): void {
  if (registered) return;
  const courseTable: Record<string, ReturnType<typeof toEngineCourse>> = {};
  for (const c of courses) courseTable[String(c.id)] = toEngineCourse(c);
  const skillTable: Record<string, ReturnType<typeof toEngineSkill>> = {};
  for (const s of skills) skillTable[String(s.id)] = toEngineSkill(s);
  registerCourses(courseTable);
  registerSkills(skillTable);
  registered = true;
}

ensureEngineData();

export { toEngineCourse, toEngineSkill } from './adapters';
