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
import eventPresetsJson from '@data/normalized/event-presets.json';

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

export interface ChampionsMeetingPreset {
  kind: 'champions-meeting';
  id: number;
  name: string;
  status: 'released-on-global' | 'upcoming-on-global';
  courseId: number | null;
  courseName: string | null;
  trackId: number;
  distance: number;
  surface: 'turf' | 'dirt' | null;
  direction: 'right' | 'left' | 'straight' | null;
  trackCondition: 'firm' | 'good' | 'soft' | 'heavy';
  weather: 'sunny' | 'cloudy' | 'rainy' | 'snowy';
  season: 'spring' | 'summer' | 'autumn' | 'winter' | 'sakura';
  startsAt: number | null;
  endsAt: number | null;
  sourceUrl: string;
}

export interface EventPresets {
  generatedAt: string;
  note: string;
  championsMeeting: {
    available: boolean;
    highestGlobalId: number;
    firstUpcomingId: number | null;
    entries: ChampionsMeetingPreset[];
    sourceUrl: string;
  };
  leagueOfHeroes: {
    available: boolean;
    reason: string;
    sourceUrl: string;
    entries: never[];
  };
}

export const eventPresets = eventPresetsJson as unknown as EventPresets;

/**
 * Live status of a cup.
 *
 * The stored `status` only records whether Global's own cup list contained the id
 * when the data was last fetched. GameTora adds a cup to that list when it is
 * ANNOUNCED, not when it finishes, so membership alone would label an announced
 * cup as already run. Deriving the real state from the cup's own start/end
 * timestamps keeps the labels honest even if the data snapshot is a few days old.
 */
export type CupState = 'completed' | 'running-now' | 'announced' | 'upcoming';

export function cupState(preset: ChampionsMeetingPreset, nowSeconds: number | null): CupState {
  if (preset.status === 'upcoming-on-global') return 'upcoming';
  // Scheduled on Global but we have no clock yet (pre-hydration): fall back to the
  // snapshot's own classification rather than guessing.
  if (nowSeconds == null || preset.startsAt == null || preset.endsAt == null) return 'completed';
  if (preset.endsAt < nowSeconds) return 'completed';
  if (preset.startsAt > nowSeconds) return 'announced';
  return 'running-now';
}

/** The next cup that has not finished yet - announced, running, or predicted. */
export function nextCup(nowSeconds: number | null): ChampionsMeetingPreset | null {
  const sorted = eventPresets.championsMeeting.entries.slice().sort((a, b) => a.id - b.id);
  return sorted.find((c) => cupState(c, nowSeconds) !== 'completed') ?? null;
}

/** Days since the underlying GameTora payload was fetched. */
export function dataAgeDays(nowSeconds: number | null): number | null {
  if (nowSeconds == null) return null;
  const fetched = Date.parse(dataMeta.dataFetchedAt);
  if (Number.isNaN(fetched)) return null;
  return Math.floor((nowSeconds * 1000 - fetched) / 86_400_000);
}

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
