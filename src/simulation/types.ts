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
}

export interface SkillConditionGroup {
  condition: string;
  precondition: string | null;
  /** -1 means a permanent (passive) effect. */
  baseDurationSeconds: number;
  cooldownSeconds: number | null;
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

/** State a skill predicate can read when deciding whether to fire. */
export interface ConditionContext {
  position: number;
  timeSeconds: number;
  phase: number;
  hpFraction: number;
  isLastSpurt: boolean;
  relative: import('./raceEvents').RaceRelativeState;
  events: import('./raceEvents').RaceEventHistory;
}

/** An effect instance scheduled into the simulation. */
export interface ScheduledEffect {
  skillId: number;
  /** Metres from the start line where the effect begins (positional triggers). */
  activateAtMeters: number;
  /** Duration in seconds; `Infinity` for passives applied from the gate. */
  durationSeconds: number;
  effects: SkillEffect[];
  /**
   * Event-driven trigger. When present the effect fires at the first frame inside
   * [windowStart, windowEnd) where `predicate` is true, instead of at a fixed
   * position. This is what makes overtake / rank / nearby-runner skills activate at
   * the position the event actually happened.
   */
  trigger?: {
    windowStart: number;
    windowEnd: number;
    predicate: (ctx: ConditionContext) => boolean;
  };
}

export interface SimulationResult {
  finishTimeSeconds: number;
  finished: boolean;
  /** Travel speed as the finish line was crossed. */
  finishSpeed: number;
  /** Lowest HP fraction reached during the race. */
  minHpFraction: number;
  ranOutOfStamina: boolean;
  /** HP left at the finish, as a share of max HP. */
  hpRemainingFraction: number;
  /** Where the last spurt began, or null when the final leg was never reached. */
  spurtStartMeters: number | null;
  spurtSpeed: number | null;
  /** True when the runner could afford a full-speed spurt for the whole final leg. */
  fullSpurt: boolean;
  startDelaySeconds: number;
  seed: number;
  /** Seconds each scheduled effect was actually inside the race. */
  effectiveDurationSeconds: Record<number, number>;
  /** Seconds each scheduled effect was cut short by the finish line, or never fired. */
  wastedDurationSeconds: Record<number, number>;
  /** Where each effect actually fired (absent when the Wit proc roll failed). */
  activationPositions: Record<number, number>;
  /** Per-frame (time, position) samples; only populated when requested. */
  trace: { t: number; pos: number }[];
}
