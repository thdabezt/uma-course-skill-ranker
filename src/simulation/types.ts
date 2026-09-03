import type { DistanceCategory } from '@/courses/distanceCategory';
import type { SkillCategory } from '@/skills/classification';
import type {
  Aptitude,
  Mood,
  RunningStyle,
  Season,
  Surface,
  TrackCondition,
  Weather,
} from './config';

export interface Section {
  start: number;
  end: number;
}

export interface CornerSection extends Section {
  number?: number;
}

export interface StraightSection extends Section {
  kind: string;
  /** Game value: 1 = home straight (in front of the stands), 2 = back straight, 3 = other. */
  frontType: number;
}

export interface SlopeSection extends Section {
  gradePercent: number;
}

export interface PhaseSection extends Section {
  phase: number;
}

export interface Course {
  id: number;
  trackId: number;
  trackName: string;
  name: string;
  distance: number;
  distanceCategory: DistanceCategory;
  /** GameTora's own (unreliable) distance enum, kept for the audit report only. */
  upstreamDistanceCategory: DistanceCategory | null;
  surface: Surface;
  direction: 'right' | 'left' | 'straight';
  layout: string;
  corners: CornerSection[];
  straights: StraightSection[];
  uphills: SlopeSection[];
  downhills: SlopeSection[];
  phases: PhaseSection[];
  finalCorner: Section | null;
  finalStraightStart: number;
  spurtStart: { meters: number; location: string[] } | null;
  positionKeepEnd: number;
  laps: number;
  statThresholds: string[];
  globalAvailable: true;
  sourceUrl: string;
  lastVerifiedAt: string;
}

export interface SkillEffect {
  kind: string;
  rawType: number;
  rawValue: number;
  /** uma-skill-tools SkillTarget id: 1 = owner, 2 = everyone, other = other runners. */
  target: number;
  /** Game modifier-scaling mode (1 = fixed value). */
  scaling: number;
}

export interface SkillConditionGroup {
  condition: string;
  precondition: string | null;
  /** -1 means a permanent (passive) effect. */
  baseDurationSeconds: number;
  cooldownSeconds: number | null;
  /** Game duration-scaling mode (1 = fixed duration). */
  durationScaling: number;
  effects: SkillEffect[];
}

export type SkillRarity =
  | 'normal'
  | 'gold'
  | 'unique'
  | 'unique_upgraded'
  | 'evolution'
  /** The weaker, purchasable copy of a unique skill, obtained through inheritance. */
  | 'inherited_unique';

export interface Skill {
  id: number;
  name: string;
  description: string;
  conditionText: string;
  rarity: SkillRarity;
  iconId: number;
  iconUrl: string;
  baseCost: number | null;
  totalCost: number | null;
  prerequisiteIds: number[];
  upgradeOfId: number | null;
  tags: string[];
  tagLabels: string[];
  runningStyleRestriction: string[];
  surfaceRestriction: string[];
  distanceRestriction: string[];
  effectKinds: string[];
  filterBuckets: string[];
  isPassive: boolean;
  isDebuff: boolean;
  /** Always false in the shipped data: negative skills are dropped at normalization. */
  isNegativeSkill: false;
  /** Whether the Wit activation roll applies to this skill. */
  wisdomCheck: boolean;
  /** Provenance of the engine-only fields. */
  engineSource: 'uma-tools' | 'inferred';
  /** Numeric game tag ids; `[-1]` when unknown upstream. */
  engineTags: number[];
  isInheritedUnique: boolean;
  /** The unique skill this inheritable copy comes from. */
  inheritedFromSkillId: number | null;
  /** True when Global ships different values from the Japanese version. */
  usesGlobalOverride: boolean;
  category: Exclude<SkillCategory, 'negative'>;
  /** Canonical GameTora page, when one exists. Absent means "do not link". */
  gameToraUrl?: string;
  gameToraUrlKind?: 'character' | 'skill';
  ownerCardIds: number[];
  globalAvailable: true;
  sourceUrl: string;
  lastVerifiedAt: string;
  conditionGroups: SkillConditionGroup[];
}

export interface CharacterCard {
  cardId: number;
  charId: number;
  name: string;
  title: string;
  rarity: number;
  imageUrl: string;
  gameToraUrl?: string;
  aptitude: Record<
    | 'turf'
    | 'dirt'
    | 'sprint'
    | 'mile'
    | 'medium'
    | 'long'
    | 'front_runner'
    | 'pace_chaser'
    | 'late_surger'
    | 'end_closer',
    Aptitude
  >;
  uniqueSkillIds: number[];
  primaryUniqueSkillId: number;
  awakeningSkillIds: number[];
  innateSkillIds: number[];
  evolutionSkillIds: number[];
  globalAvailable: true;
  globalReleaseDate: string;
  sourceUrl: string;
  lastVerifiedAt: string;
}

export interface SkillConditionDoc {
  name: string;
  description: string;
  example: string;
  exampleMeaning: string;
  note: string;
}

/** Everything the user picks in the course selector. */
export interface RaceSetup {
  course: Course;
  runningStyle: RunningStyle;
  trackCondition: TrackCondition;
  weather: Weather;
  season: Season;
}

export interface RunnerStats {
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wit: number;
  mood: Mood;
  distanceAptitude: Aptitude;
  surfaceAptitude: Aptitude;
  styleAptitude: Aptitude;
  runningStyle: RunningStyle;
  /** null = derive from Wit with the in-game proc-rate formula. */
  skillActivationRate: number | null;
  startDelaySeconds: number;
  postNumber: number;
  popularity: number;
}
