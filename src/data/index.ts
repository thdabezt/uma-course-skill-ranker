/**
 * Application data, normalized from GameTora's public payloads by
 * `scripts/build-data.mjs`. Global-only: JP-exclusive content lives in a separate
 * file that is loaded on demand by the developer view and is never merged in here.
 */

import charactersJson from '@data/normalized/characters.json';
import coursesJson from '@data/normalized/courses.json';
import metaJson from '@data/normalized/meta.json';
import skillConditionsJson from '@data/normalized/skill-conditions.json';
import skillsJson from '@data/normalized/skills.json';

import type { CharacterCard, Course, Skill, SkillConditionDoc } from '@/simulation/types';

export const courses = coursesJson as unknown as Course[];
export const skills = skillsJson as unknown as Skill[];
export const characters = charactersJson as unknown as CharacterCard[];
export const skillConditionDocs = skillConditionsJson as unknown as SkillConditionDoc[];

export interface DataMeta {
  generatedAt: string;
  dataFetchedAt: string;
  server: string;
  source: {
    name: string;
    homepage: string;
    manifest: string;
    documents: { key: string; file: string; contentHash: string; sourceUrl: string }[];
  };
  counts: Record<string, number>;
  evolutionSkillsAvailableOnGlobal: boolean;
  notes: string[];
}

export const dataMeta = metaJson as unknown as DataMeta;

export const skillsById = new Map(skills.map((s) => [s.id, s]));
export const coursesById = new Map(courses.map((c) => [c.id, c]));
export const conditionDocByName = new Map(skillConditionDocs.map((c) => [c.name, c]));

export const trackNames = [...new Set(courses.map((c) => c.trackName))].sort();

export function coursesForTrack(trackName: string): Course[] {
  return courses.filter((c) => c.trackName === trackName);
}

export interface ExcludedContent {
  note: string;
  courses: { id: number; trackName: string; name: string; reason: string }[];
  skills: { id: number; name: string; rarity: string; reason: string }[];
  characters: { cardId: number; name: string; reason: string }[];
}

/** Developer-only. Loaded lazily so JP-exclusive data never ships in the main bundle path. */
export async function loadExcludedContent(): Promise<ExcludedContent> {
  const mod = await import('@data/normalized/excluded-non-global.json');
  return (mod.default ?? mod) as unknown as ExcludedContent;
}
