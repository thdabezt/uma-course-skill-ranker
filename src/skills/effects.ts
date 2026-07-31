import { SIMULATION } from '@/simulation/config';
import type { SkillConditionGroup, SkillEffect } from '@/simulation/types';

/** Effect kinds the solo simulation reproduces. */
export const MODELLED_EFFECT_KINDS = new Set([
  'target_speed',
  'acceleration',
  'current_speed',
  'stamina_recovery',
  'speed_stat',
  'power_stat',
  'guts_stat',
  'stamina_stat',
  'wit_stat',
  'all_stats',
]);

/** Effect kinds that only matter with opponents on the track. */
export const FIELD_ONLY_EFFECT_KINDS = new Set([
  'field_of_view',
  'lane_movement',
  'change_lane',
  'rush_chance',
  'rush_time',
  'change_strategy',
  'debuff_immunity',
  'random_rare_skills',
  'reactivate_unique_skill',
  'start_reaction',
  'start_delay',
  'carnival_points',
  'carnival_stats',
  'carnival_motivation',
]);

export const EFFECT_LABELS: Record<string, string> = {
  target_speed: 'Target speed',
  current_speed: 'Current speed',
  acceleration: 'Acceleration',
  stamina_recovery: 'Stamina recovery',
  speed_stat: 'Speed stat',
  stamina_stat: 'Stamina stat',
  power_stat: 'Power stat',
  guts_stat: 'Guts stat',
  wit_stat: 'Wit stat',
  all_stats: 'All stats',
  change_strategy: 'Change running style',
  field_of_view: 'Field of view',
  start_reaction: 'Start reaction',
  start_delay: 'Start delay',
  rush_time: 'Rush duration',
  rush_chance: 'Rush chance',
  lane_movement: 'Lane movement speed',
  change_lane: 'Change lane',
  debuff_immunity: 'Debuff immunity',
  random_rare_skills: 'Random rare skills',
  reactivate_unique_skill: 'Reactivate unique skill',
  carnival_points: 'Racing Carnival points',
  carnival_stats: 'Racing Carnival stats',
  carnival_motivation: 'Racing Carnival mood',
};

/** Skill duration scales with course length. */
export function durationSeconds(group: SkillConditionGroup, courseDistance: number): number {
  if (group.baseDurationSeconds < 0) return Infinity;
  return group.baseDurationSeconds * (courseDistance / SIMULATION.durationDistanceReference);
}

export function describeEffect(effect: SkillEffect): string {
  const label = EFFECT_LABELS[effect.kind] ?? effect.kind;
  switch (effect.kind) {
    case 'target_speed':
    case 'current_speed':
      return `${label} ${signed(effect.rawValue / SIMULATION.effectValueScale, 3)} m/s`;
    case 'acceleration':
      return `${label} ${signed(effect.rawValue / SIMULATION.effectValueScale, 3)} m/s²`;
    case 'stamina_recovery':
      return `${label} ${signed((effect.rawValue / SIMULATION.recoveryValueScale) * 100, 2)}% of max stamina`;
    case 'speed_stat':
    case 'stamina_stat':
    case 'power_stat':
    case 'guts_stat':
    case 'wit_stat':
    case 'all_stats':
      return `${label} ${signed(effect.rawValue / SIMULATION.effectValueScale, 0)}`;
    default:
      return label;
  }
}

function signed(value: number, digits: number): string {
  const s = value.toFixed(digits);
  return value >= 0 ? `+${s}` : s;
}

export function hasModelledEffect(effects: SkillEffect[]): boolean {
  return effects.some((e) => MODELLED_EFFECT_KINDS.has(e.kind));
}

export function unmodelledKinds(effects: SkillEffect[]): string[] {
  return [...new Set(effects.filter((e) => !MODELLED_EFFECT_KINDS.has(e.kind)).map((e) => e.kind))];
}
