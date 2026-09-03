/**
 * Which skills each tab analyses, and how a batch of them is run.
 */
import type { Skill } from '@/simulation/types';
import { analyzeSkill, type AnalysisContext, type SkillAnalysis } from './skillAnalysis';

/** Skill subsets the UI asks for. */
export type SkillSet = 'speed' | 'accel' | 'characters';

/** Rarity filter of the skill tabs. Innate uniques only appear in the character tab. */
export type RarityFilter = 'normal' | 'inherited_unique' | 'all';

export const INNATE_RARITIES = new Set<Skill['rarity']>(['unique', 'unique_upgraded', 'evolution']);

/** Effect targets the skill's owner (1) or everyone (2). */
const targetsSelf = (target: number) => target === 1 || target === 2;

/** Target-speed (27) or current-speed (21 / 22) bonus for the owner in any variant. */
export function hasSpeedEffect(skill: Skill): boolean {
  return skill.conditionGroups.some((g) =>
    g.effects.some((e) => (e.rawType === 27 || e.rawType === 21 || e.rawType === 22) && e.rawValue > 0 && targetsSelf(e.target)),
  );
}

/** Acceleration (31) bonus for the owner in any variant. */
export function hasAccelEffect(skill: Skill): boolean {
  return skill.conditionGroups.some((g) => g.effects.some((e) => e.rawType === 31 && e.rawValue > 0 && targetsSelf(e.target)));
}

/**
 * Tab membership goes by effects, not by the single display category: a skill
 * with a speed part and an acceleration part belongs to both tabs.
 */
export function isSpeedSkill(skill: Skill): boolean {
  return !skill.isDebuff && hasSpeedEffect(skill);
}

export function isAccelSkill(skill: Skill): boolean {
  return !skill.isDebuff && hasAccelEffect(skill);
}

export function selectSkills(all: Skill[], set: SkillSet): Skill[] {
  switch (set) {
    case 'speed':
      return all.filter((s) => isSpeedSkill(s) && !INNATE_RARITIES.has(s.rarity));
    case 'accel':
      return all.filter((s) => isAccelSkill(s) && !INNATE_RARITIES.has(s.rarity));
    case 'characters':
      return all.filter((s) => INNATE_RARITIES.has(s.rarity));
  }
}

/** Every skill any tab can show: the union of the three sets. */
export function selectAllAnalyzed(all: Skill[]): Skill[] {
  const ids = new Set<number>();
  const out: Skill[] = [];
  for (const set of ['speed', 'accel', 'characters'] as SkillSet[]) {
    for (const s of selectSkills(all, set)) {
      if (!ids.has(s.id)) {
        ids.add(s.id);
        out.push(s);
      }
    }
  }
  return out;
}

export function matchesRarity(skill: Skill, filter: RarityFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'inherited_unique') return skill.rarity === 'inherited_unique';
  return skill.rarity === 'normal' || skill.rarity === 'gold';
}

export interface RankRow {
  skillId: number;
  analysis: SkillAnalysis;
}

/** Sample counts of the two analysis passes. */
export const SAMPLES = {
  /** First pass over every skill: enough to find the ones that matter. */
  screening: 24,
  /** Second pass over skills that showed any effect. */
  detail: 120,
} as const;

/** Skills worth a second, larger pass. */
export function deservesDetail(a: SkillAnalysis): boolean {
  return a.reliability !== 'never' && a.error == null && (a.gain.max > 0.1 || a.gain.min < -0.1);
}

export function analyzeMany(
  ctx: AnalysisContext,
  skills: Skill[],
  samples: number,
  onProgress?: (done: number, total: number) => void,
): RankRow[] {
  const rows: RankRow[] = [];
  skills.forEach((skill, i) => {
    rows.push({ skillId: skill.id, analysis: analyzeSkill(ctx, skill, samples) });
    if (onProgress && (i % 10 === 0 || i === skills.length - 1)) onProgress(i + 1, skills.length);
  });
  return rows;
}

export const byMeanGain = (a: RankRow, b: RankRow) => b.analysis.gain.mean - a.analysis.gain.mean;
