/**
 * SINGLE SOURCE OF TRUTH for skill classification.
 *
 * Imported by both the application and `scripts/build-data.mjs` (Node
 * type-stripping) so the pipeline and the UI can never disagree.
 *
 * The key distinction this file makes:
 *
 *   NEGATIVE SKILL  - an acquired flaw the runner carries into the race: the "x"
 *                     aptitude skills (Right-Handed x, Tokyo Racecourse x, ...),
 *                     bad conditions (Wallflower, Paddock Fright, Defeatist,
 *                     Reckless, Packphobia, ...) and purple negative skills
 *                     (Blatant Fear). Every effect it has is bad for its owner and
 *                     it is not a debuff aimed at opponents. These are excluded
 *                     from the data set entirely.
 *
 *   DEBUFF          - a normal purple skill that worsens OTHER runners
 *                     (Intimidate, Smoke Screen, Hesitant Front Runners, ...).
 *                     Kept, and classified separately.
 *
 * A skill with a downside AND an upside (Nothing Ventured, Second Wind,
 * Full Throttle) is a normal skill, not a negative skill.
 */

export type SkillCategory =
  | 'speed'
  | 'acceleration'
  | 'current_speed'
  | 'recovery'
  | 'passive'
  | 'debuff'
  | 'negative';

/**
 * Whether a raw effect value is bad for the skill's owner.
 *
 * Mirrors GameTora's own per-effect-type sign rules: for most effects a negative
 * value is bad, but "reduce start delay" is stored so that a non-negative value
 * adds delay, and "improve start reaction" is stored so that a value at or above
 * the scale worsens it. A few effect types are never negative.
 */
export function isNegativeEffect(effectType: number, rawValue: number): boolean {
  switch (effectType) {
    // better_start_reaction: >= 10000 means the reaction time got worse.
    case 10:
      return rawValue >= 10000;
    // reduce_start_delay: >= 0 means delay is added instead of removed.
    case 14:
      return rawValue >= 0;
    // change_strategy, change_lane, random rare skills, debuff immunity,
    // zenkai acceleration, reactivate unique, carnival stat/mood: never negative.
    case 6:
    case 35:
    case 37:
    case 38:
    case 48:
    case 49:
    case 502:
    case 503:
      return false;
    default:
      return rawValue < 0;
  }
}

export interface ClassificationInput {
  /** GameTora `type` tag list, e.g. ['cor', 'nac'] or ['dbf']. */
  tags: string[];
  /** Every effect across every condition group. */
  effects: { rawType: number; rawValue: number }[];
  /** True when every condition group is permanent (base duration -1). */
  isPassive: boolean;
  /** Normalized effect kind names, e.g. ['target_speed']. */
  effectKinds: string[];
}

export const isOpponentDebuff = (tags: string[]): boolean => tags.includes('dbf');

/**
 * A negative skill is one where every single effect hurts its owner and which is
 * not a debuff aimed at the rest of the field.
 */
export function isNegativeSkill(input: ClassificationInput): boolean {
  if (isOpponentDebuff(input.tags)) return false;
  if (input.effects.length === 0) return false;
  return input.effects.every((e) => isNegativeEffect(e.rawType, e.rawValue));
}

/** Primary category used by the UI filters. `negative` never reaches the UI. */
export function classifySkill(input: ClassificationInput): SkillCategory {
  if (isNegativeSkill(input)) return 'negative';
  if (isOpponentDebuff(input.tags)) return 'debuff';
  if (input.effectKinds.includes('target_speed')) return 'speed';
  if (input.effectKinds.includes('acceleration')) return 'acceleration';
  if (input.effectKinds.includes('current_speed')) return 'current_speed';
  if (input.effectKinds.includes('stamina_recovery')) return 'recovery';
  if (input.isPassive) return 'passive';
  return 'passive';
}

/**
 * All buckets a skill belongs to for the UI filter chips. A skill can match more
 * than one (a passive that raises Speed is both `passive` and `speed`).
 */
export function skillFilterBuckets(input: ClassificationInput): SkillCategory[] {
  if (isNegativeSkill(input)) return ['negative'];
  const b = new Set<SkillCategory>();
  for (const k of input.effectKinds) {
    if (k === 'target_speed') b.add('speed');
    else if (k === 'acceleration') b.add('acceleration');
    else if (k === 'current_speed') b.add('current_speed');
    else if (k === 'stamina_recovery') b.add('recovery');
  }
  if (input.isPassive) b.add('passive');
  if (isOpponentDebuff(input.tags)) b.add('debuff');
  // Skills whose only effects are field-dependent (rush duration, lane movement,
  // start reaction, ...) still need a bucket so they remain filterable.
  if (b.size === 0) b.add(classifySkill(input));
  return [...b];
}
