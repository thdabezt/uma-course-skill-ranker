#!/usr/bin/env node
/**
 * Normalizes `data/raw/*.json` (verbatim GameTora payloads) into the application
 * data model under `data/normalized/`.
 *
 * Responsibilities:
 *  - split Global-available content from JP-only content (never mixed)
 *  - decode GameTora's numeric enums into explicit English strings
 *  - resolve skill prerequisite chains and total SP cost
 *  - validate every record and reject malformed / incomplete entries
 *
 * Usage:  node scripts/build-data.mjs [--strict]
 *         --strict  exit non-zero if any record was rejected
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Shared single-source-of-truth modules. Run with `node --experimental-strip-types`
// so the pipeline and the application can never classify things differently.
import {
  DISTANCE_CATEGORY_BY_SKILL_TAG,
  GAMETORA_DISTANCE_ENUM,
  getDistanceCategory,
} from '../src/courses/distanceCategory.ts';
import {
  classifySkill,
  isNegativeSkill,
  isOpponentDebuff,
  skillFilterBuckets,
} from '../src/skills/classification.ts';
import { characterUrl, isValidGameToraUrl } from '../src/data/gametora.ts';
import { auditCourses, formatCourseIssues } from './lib/audit-courses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'normalized');

const GLOBAL_SERVER = 'en';
const SOURCE = 'https://gametora.com/umamusume';

const readRaw = async (f) => JSON.parse(await readFile(path.join(RAW, f), 'utf8'));
/** Optional payload: an absent file yields null instead of failing the build. */
const readRawOptional = async (f) => {
  try {
    return await readRaw(f);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
};

/* ------------------------------------------------------------------ enums */

/** GameTora `terrain`: 1 = turf, 2 = dirt. */
const SURFACE = { 1: 'turf', 2: 'dirt' };

/** GameTora `turn`: 1 = right (clockwise), 2 = left (counter-clockwise), 4 = straight. */
const DIRECTION = { 1: 'right', 2: 'left', 4: 'straight' };

/** GameTora `inout` course-layout variant. */
/*
 * Verified against umalator's `inoutKey = ['', 'none', 'inner', 'outer', 'outin']`
 * (uma-tools components/RaceTrack.tsx) and the real JRA layouts: Kyoto 1200 / 2000
 * and Nakayama 1800 / 2000 / 2500 run on the inner track and carry inout 2; Kyoto
 * 1800 / 2200 / 2400 / 3000 and Nakayama 1200 / 1600 / 2200 run on the outer track
 * and carry inout 3; Hanshin 3200 starts on the outer loop and finishes on the
 * inner one (inout 4). Racecourses with a single layout use 1.
 */
const LAYOUT = { 1: 'standard', 2: 'inner', 3: 'outer', 4: 'outer-inner' };

/** Suffix appended to a course name so layout variants of one distance stay distinct. */
const LAYOUT_NAME_SUFFIX = { inner: ' (inner)', outer: ' (outer)', 'outer-inner': ' (outer to inner)' };

// Distance classification comes from src/courses/distanceCategory.ts. GameTora's
// own numeric enum is kept only as a cross-check (GAMETORA_DISTANCE_ENUM).

/** Straight `frontType`: 1 = home straight (finish line), 2/3 = backstretch variants. */
const STRAIGHT_KIND = { 1: 'home', 2: 'backstretch', 3: 'backstretch' };

/** Stat threshold hints GameTora surfaces per course. */
const STAT_THRESHOLD = { 1: 'speed', 2: 'stamina', 3: 'power', 4: 'guts', 5: 'wit' };

/**
 * Skill effect type ids -> stable English keys.
 * Verified against gametora.com's own `skill_effect` label table.
 */
const EFFECT_TYPES = {
  1: 'speed_stat',
  2: 'stamina_stat',
  3: 'power_stat',
  4: 'guts_stat',
  5: 'wit_stat',
  6: 'change_strategy',
  8: 'field_of_view',
  9: 'stamina_recovery',
  10: 'start_reaction',
  13: 'rush_time',
  14: 'start_delay',
  21: 'current_speed',
  22: 'current_speed',
  27: 'target_speed',
  28: 'lane_movement',
  29: 'rush_chance',
  31: 'acceleration',
  32: 'all_stats',
  35: 'change_lane',
  37: 'random_rare_skills',
  38: 'debuff_immunity',
  48: 'zenkai_acceleration',
  49: 'reactivate_unique_skill',
  501: 'carnival_points',
  502: 'carnival_stats',
  503: 'carnival_motivation',
};

/** GameTora skill tag ids -> English labels. */
const SKILL_TAGS = {
  nac: 'No style or distance restriction',
  run: 'Front Runner',
  ldr: 'Pace Chaser',
  btw: 'Late Surger',
  cha: 'End Closer',
  sho: 'Sprint',
  mil: 'Mile',
  med: 'Medium',
  lng: 'Long',
  dir: 'Dirt',
  tur: 'Turf',
  l_0: 'Opening leg',
  l_1: 'Middle leg',
  l_2: 'Final leg',
  l_3: 'Last spurt',
  cor: 'Corner',
  str: 'Straight',
  f_c: 'Final corner',
  f_s: 'Final straight',
  slo: 'Slope',
  dbf: 'Debuff',
};

const RUNNING_STYLE_BY_TAG = {
  run: 'front_runner',
  ldr: 'pace_chaser',
  btw: 'late_surger',
  cha: 'end_closer',
};

const SURFACE_BY_TAG = { tur: 'turf', dir: 'dirt' };

/**
 * Racecourse names. GameTora keeps track names in its UI translation bundle rather
 * than in the data payload, so the id -> English name map is maintained here.
 * Verified against https://gametora.com/umamusume/racetracks (list order).
 */
const TRACK_NAMES = {
  10001: 'Sapporo',
  10002: 'Hakodate',
  10003: 'Niigata',
  10004: 'Fukushima',
  10005: 'Nakayama',
  10006: 'Tokyo',
  10007: 'Chukyo',
  10008: 'Kyoto',
  10009: 'Hanshin',
  10010: 'Kokura',
  10101: 'Ooi',
  10103: 'Kawasaki',
  10104: 'Funabashi',
  10105: 'Morioka',
  10201: 'Longchamp',
  10202: 'Santa Anita Park',
  10203: 'Del Mar',
};

/* --------------------------------------------------------------- schemas */

const EffectSchema = z.object({
  kind: z.string().min(1),
  rawType: z.number().int(),
  rawValue: z.number(),
  /**
   * uma-skill-tools SkillTarget id: 1 = the skill's owner, 2 = everyone, any other
   * value = other runners only (debuff). Decides which effects the engine applies
   * to the simulated runner.
   */
  target: z.number().int(),
  /** Game modifier-scaling mode (1 = fixed value); see RaceSolver.getScaledModifier. */
  scaling: z.number().int(),
});

const ConditionGroupSchema = z.object({
  condition: z.string().min(1),
  precondition: z.string().nullable(),
  baseDurationSeconds: z.number(),
  cooldownSeconds: z.number().nullable(),
  /** Game duration-scaling mode (1 = fixed duration); see RaceSolver.getScaledDuration. */
  durationScaling: z.number().int(),
  effects: z.array(EffectSchema).min(1),
});

const SkillSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  conditionText: z.string().min(1),
  rarity: z.enum(['normal', 'gold', 'unique', 'unique_upgraded', 'evolution', 'inherited_unique']),
  /** True for the weaker inheritable copy of a character's unique skill. */
  isInheritedUnique: z.boolean(),
  /** Id of the unique skill this inherited version comes from. */
  inheritedFromSkillId: z.number().int().nullable(),
  /** True when Global ships different values from the Japanese version. */
  usesGlobalOverride: z.boolean(),
  iconId: z.number().int(),
  iconUrl: z.string().url(),
  baseCost: z.number().int().nonnegative().nullable(),
  totalCost: z.number().int().nonnegative().nullable(),
  prerequisiteIds: z.array(z.number().int()),
  upgradeOfId: z.number().int().nullable(),
  tags: z.array(z.string()),
  tagLabels: z.array(z.string()),
  runningStyleRestriction: z.array(z.string()),
  surfaceRestriction: z.array(z.string()),
  distanceRestriction: z.array(z.string()),
  effectKinds: z.array(z.string()),
  isPassive: z.boolean(),
  isDebuff: z.boolean(),
  isNegativeSkill: z.literal(false),
  /** Whether the Wit activation roll applies (false for uniques and most passives). */
  wisdomCheck: z.boolean(),
  /** Where the engine-only fields (target, wisdomCheck) came from. */
  engineSource: z.enum(['uma-tools', 'inferred']),
  /**
   * Numeric game tag ids (e.g. 401 speed, 403 acceleration, 6xx grouped skills).
   * The engine counts an activation only for tagged (real) skills and uses the
   * 600-699 group for one scaling rule. `[-1]` when unknown upstream.
   */
  engineTags: z.array(z.number().int()),
  category: z.enum(['speed', 'acceleration', 'current_speed', 'recovery', 'passive', 'debuff']),
  filterBuckets: z.array(z.string()).min(1),
  gameToraUrl: z.string().url().optional(),
  gameToraUrlKind: z.enum(['character', 'skill']).optional(),
  ownerCardIds: z.array(z.number().int()),
  globalAvailable: z.literal(true),
  sourceUrl: z.string().url(),
  lastVerifiedAt: z.string().min(1),
  conditionGroups: z.array(ConditionGroupSchema).min(1),
});

const SectionSchema = z.object({ start: z.number(), end: z.number() });

const CourseSchema = z.object({
  id: z.number().int(),
  trackId: z.number().int(),
  trackName: z.string().min(1),
  name: z.string().min(1),
  distance: z.number().int().positive(),
  distanceCategory: z.enum(['sprint', 'mile', 'medium', 'long']),
  /** GameTora's own (unreliable) enum, kept for the audit report only. */
  upstreamDistanceCategory: z.enum(['sprint', 'mile', 'medium', 'long']).nullable(),
  surface: z.enum(['turf', 'dirt']),
  direction: z.enum(['right', 'left', 'straight']),
  layout: z.string().min(1),
  corners: z.array(SectionSchema.extend({ number: z.number().int() })),
  straights: z.array(SectionSchema.extend({ kind: z.string(), frontType: z.number().int() })),
  uphills: z.array(SectionSchema.extend({ gradePercent: z.number().positive() })),
  downhills: z.array(SectionSchema.extend({ gradePercent: z.number().positive() })),
  phases: z.array(SectionSchema.extend({ phase: z.number().int().min(0).max(3) })).length(4),
  finalCorner: SectionSchema.nullable(),
  finalStraightStart: z.number(),
  spurtStart: z.object({ meters: z.number(), location: z.array(z.string()) }).nullable(),
  positionKeepEnd: z.number(),
  laps: z.number().int().positive(),
  statThresholds: z.array(z.string()),
  globalAvailable: z.literal(true),
  sourceUrl: z.string().url(),
  lastVerifiedAt: z.string().min(1),
});

const CharacterSchema = z.object({
  cardId: z.number().int(),
  charId: z.number().int(),
  name: z.string().min(1),
  title: z.string(),
  rarity: z.number().int().min(1).max(3),
  imageUrl: z.string().url(),
  gameToraUrl: z.string().url().optional(),
  aptitude: z.object({
    turf: z.string(),
    dirt: z.string(),
    sprint: z.string(),
    mile: z.string(),
    medium: z.string(),
    long: z.string(),
    front_runner: z.string(),
    pace_chaser: z.string(),
    late_surger: z.string(),
    end_closer: z.string(),
  }),
  uniqueSkillIds: z.array(z.number().int()).min(1),
  primaryUniqueSkillId: z.number().int(),
  awakeningSkillIds: z.array(z.number().int()),
  innateSkillIds: z.array(z.number().int()),
  evolutionSkillIds: z.array(z.number().int()),
  globalAvailable: z.literal(true),
  globalReleaseDate: z.string().min(1),
  sourceUrl: z.string().url(),
  lastVerifiedAt: z.string().min(1),
});

/* ------------------------------------------------------------- helpers */

const APTITUDE_ORDER = [
  'turf',
  'dirt',
  'sprint',
  'mile',
  'medium',
  'long',
  'front_runner',
  'pace_chaser',
  'late_surger',
  'end_closer',
];

const skillIconUrl = (iconId) =>
  `https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_${iconId}.png`;

const cardImageUrl = (charId, cardId) =>
  `https://gametora.com/images/umamusume/characters/thumb/chara_stand_${charId}_${cardId}.png`;

const isGlobal = (unreleasedList) => !(unreleasedList ?? []).includes(GLOBAL_SERVER);

/**
 * Global-specific overrides.
 *
 * GameTora keeps per-server differences under `loc.en`. Where Global has not
 * received a Japanese balance change, `loc.en.condition_groups` holds the values
 * that are actually live on Global - for example Certain Victory triggers on the
 * final corner on Global but on the final straight after its Japanese buff.
 * Using the base record would silently ship Japanese values.
 */
function globalView(raw) {
  const en = raw.loc?.en ?? {};
  return {
    conditionGroups: en.condition_groups ?? raw.condition_groups ?? [],
    iconId: en.iconid ?? raw.iconid,
    tags: en.type ?? raw.type ?? [],
    ownerCardIds: en.char ?? raw.char ?? [],
    overridden: Boolean(en.condition_groups || en.iconid || en.type),
  };
}

/** The Global view of a unique skill's inheritable copy, when one exists. */
function globalGeneView(raw) {
  const gene = raw.gene_version;
  if (!gene) return null;
  const en = raw.loc?.en?.gene_version ?? {};
  return {
    id: gene.id,
    name: gene.name_en,
    description: gene.desc_en,
    cost: typeof gene.cost === 'number' ? gene.cost : null,
    conditionGroups: en.condition_groups ?? gene.condition_groups ?? [],
    iconId: en.iconid ?? gene.iconid,
    parentId: (gene.parent_skills ?? [])[0] ?? raw.id,
    overridden: Boolean(en.condition_groups || en.iconid),
  };
}

function rarityLabel(rawRarity) {
  if (rawRarity === 1) return 'normal';
  if (rawRarity === 2) return 'gold';
  if (rawRarity === 3) return 'unique';
  if (rawRarity === 4) return 'unique_upgraded';
  if (rawRarity === 5) return 'unique';
  if (rawRarity === 6) return 'evolution';
  return null;
}

/* ---------------------------------------------------------------- build */

async function main() {
  const strict = process.argv.includes('--strict');
  await mkdir(OUT, { recursive: true });

  const meta = await readRaw('_meta.json');
  const lastVerifiedAt = meta.fetchedAt;
  const sourceUrlFor = (key) =>
    meta.documents.find((d) => d.key === key)?.sourceUrl ?? meta.manifestUrl;

  const rawSkills = await readRaw('skills.json');
  const rawCharacters = await readRaw('characters.json');
  const rawCards = await readRaw('character-cards.json');
  const rawTracks = await readRaw('racetracks.json');
  const rawRaces = await readRaw('races.json');
  const rawConditions = await readRaw('skill-conditions.json');
  const rawCmGlobal = await readRaw('champions-meeting-global.json');
  const rawCmJp = await readRaw('champions-meeting-jp.json');
  // Engine metadata that GameTora does not publish (per-effect target, Wit-check
  // flag), taken from alpha123/uma-tools' Global skill table when it has been
  // fetched. Missing file or missing id -> conservative inference, flagged as such.
  const utSkills = (await readRawOptional('uma-tools/skill_data.json')) ?? {};
  let inferredEngineCount = 0;

  const rejected = [];
  const reject = (kind, id, reason) => rejected.push({ kind, id, reason });

  /* ---------------------------------------------------------- courses */

  // A racecourse is treated as Global-available when at least one race that runs on
  // it is released on the Global server. GameTora tags races (not tracks) per server.
  const globalTrackIds = new Set(
    rawRaces.filter((r) => isGlobal(r.unreleased_servers)).map((r) => Number(r.track)),
  );

  const courses = [];
  const excludedCourses = [];

  for (const track of rawTracks) {
    const trackId = Number(track.id);
    const trackName = TRACK_NAMES[trackId];
    if (!trackName) {
      reject('track', trackId, 'no English racecourse name mapped');
      continue;
    }
    const trackIsGlobal = globalTrackIds.has(trackId);

    for (const c of track.courses) {
      const surface = SURFACE[c.terrain];
      const direction = DIRECTION[c.turn];
      const layout = LAYOUT[c.inout];
      if (!layout) {
        reject('course', c.id, `unknown inout enum (${c.inout})`);
        continue;
      }
      // Classification always comes from the official metre bands, never from
      // GameTora's `distance` enum (which mislabels 1300 m / 1400 m courses).
      const distanceCategory = getDistanceCategory(c.length);
      const upstreamCategory = GAMETORA_DISTANCE_ENUM[c.distance] ?? null;

      if (!surface || !direction) {
        reject('course', c.id, `unknown terrain/turn enum (${c.terrain}/${c.turn})`);
        continue;
      }

      const corners = (c.corners ?? [])
        .map((x) => ({ start: x.start, end: x.end, number: x.number }))
        .sort((a, b) => a.start - b.start);
      const straights = (c.straights ?? [])
        .map((x) => ({
          start: x.start,
          end: x.end,
          kind: STRAIGHT_KIND[x.frontType] ?? 'backstretch',
          frontType: x.frontType,
        }))
        .sort((a, b) => a.start - b.start);
      const slopes = c.slopes ?? [];
      // `slope` is stored as grade x 10000 (10000 => 1.0 %). Positive = uphill.
      const uphills = slopes
        .filter((s) => s.slope > 0)
        .map((s) => ({ start: s.start, end: s.end, gradePercent: s.slope / 10000 }));
      const downhills = slopes
        .filter((s) => s.slope < 0)
        .map((s) => ({ start: s.start, end: s.end, gradePercent: Math.abs(s.slope) / 10000 }));

      const phases = (c.phases ?? [])
        .map((p) => ({ start: p.start, end: p.end, phase: p.id }))
        .sort((a, b) => a.phase - b.phase);

      const finalCorner = corners.length ? corners[corners.length - 1] : null;
      const homeStraight = straights.filter((s) => s.kind === 'home').sort((a, b) => a.start - b.start).pop();
      const finalStraightStart = homeStraight ? homeStraight.start : c.length;

      const record = {
        id: Number(c.id),
        trackId,
        trackName,
        name: `${trackName} ${surface === 'turf' ? 'Turf' : 'Dirt'} ${c.length}m${LAYOUT_NAME_SUFFIX[layout] ?? ''}`,
        distance: c.length,
        distanceCategory,
        upstreamDistanceCategory: upstreamCategory,
        surface,
        direction,
        layout,
        corners,
        straights,
        uphills,
        downhills,
        phases,
        finalCorner,
        finalStraightStart,
        spurtStart: c.spurtStart
          ? { meters: c.spurtStart.meters, location: c.spurtStart.location ?? [] }
          : null,
        positionKeepEnd: c.positionKeepEnd ?? 0,
        laps: (c.laps ?? []).length || 1,
        statThresholds: (c.statThresholds ?? []).map((s) => STAT_THRESHOLD[s]).filter(Boolean),
        globalAvailable: true,
        sourceUrl: sourceUrlFor('racetracks'),
        lastVerifiedAt,
      };

      if (!trackIsGlobal) {
        excludedCourses.push({
          id: record.id,
          trackName,
          name: record.name,
          reason: 'no Global-released race runs on this racecourse',
        });
        continue;
      }

      const parsed = CourseSchema.safeParse(record);
      if (!parsed.success) {
        reject('course', c.id, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
        continue;
      }
      courses.push(parsed.data);
    }
  }
  courses.sort(
    (a, b) => a.trackName.localeCompare(b.trackName) || a.surface.localeCompare(b.surface) || a.distance - b.distance,
  );

  /* ----------------------------------------------------------- skills */

  const skillById = new Map(rawSkills.map((s) => [s.id, s]));

  /**
   * The base skill that has to be learned before an upgraded skill becomes
   * available. In game a gold (rare) skill always sits on top of its white
   * counterpart, and both SP costs have to be paid.
   *
   * GameTora expresses the family through the `versions` array; the white member
   * whose id shares the same stem is the direct prerequisite.
   */
  function upgradeBaseOf(raw) {
    if (raw.rarity !== 2) return null;
    const family = (raw.versions ?? []).map((id) => skillById.get(id)).filter(Boolean);
    const whites = family.filter(
      (s) => s.rarity === 1 && typeof s.cost === 'number' && isGlobal(s.unreleased),
    );
    if (!whites.length) return null;
    const sameStem = whites.find((s) => Math.floor(s.id / 10) === Math.floor(raw.id / 10));
    return (sameStem ?? whites[0]).id;
  }

  // Prerequisite chain: the upgrade base, `parent_skills` on inheritance variants,
  // and the upgrade relationship expressed by `pre_evo` on evolution skills.
  function prerequisiteChain(raw, seen = new Set()) {
    const out = [];
    const push = (id) => {
      if (id == null || seen.has(id)) return;
      seen.add(id);
      const parent = skillById.get(id);
      if (!parent) return;
      out.push(id, ...prerequisiteChain(parent, seen));
    };
    push(upgradeBaseOf(raw));
    for (const p of raw.parent_skills ?? []) push(p);
    if (raw.pre_evo?.old != null) push(raw.pre_evo.old);
    return out;
  }

  const skills = [];
  const excludedSkills = [];
  const pendingSkillLinks = [];
  let negativeSkillCount = 0;
  let inheritedUniqueCount = 0;
  // A character with the unique-skill upgrade owns both the base and the upgraded
  // unique, and BOTH point at the same inheritable copy. Emit it once.
  const emittedGeneIds = new Set();
  let globalOverrideCount = 0;

  const squash = (c) => String(c ?? '').replace(/\s+/g, '');

  /**
   * Per-effect target from uma-tools, matched by condition text and effect
   * type/value rather than by index, so a filtered or reordered group can never be
   * paired with the wrong alternative. Falls back to "self", or "others" for a
   * debuff, when the skill is unknown upstream.
   */
  const findAlternative = (utSkill, group) =>
    (utSkill?.alternatives ?? []).find(
      (a) =>
        squash(a.condition) === squash(group.condition) &&
        squash(a.precondition) === squash(group.precondition),
    ) ?? null;

  const effectTarget = (utSkill, group, effect, isDebuff) => {
    const fallback = isDebuff ? 9 : 1;
    const alt = findAlternative(utSkill, group);
    if (!alt) return fallback;
    const match = (alt.effects ?? []).find((e) => e.type === effect.type && e.modifier === effect.value);
    return match ? match.target : fallback;
  };

  const effectScaling = (utSkill, group, effect) => {
    const alt = findAlternative(utSkill, group);
    const match = alt && (alt.effects ?? []).find((e) => e.type === effect.type && e.modifier === effect.value);
    return match && typeof match.scaling === 'number' ? match.scaling : 1;
  };

  const groupDurationScaling = (utSkill, group) => {
    const alt = findAlternative(utSkill, group);
    return alt && typeof alt.durationScaling === 'number' ? alt.durationScaling : 1;
  };

  const normalizeGroups = (rawGroups, utSkill, isDebuff) =>
    (rawGroups ?? [])
      .map((g) => ({
        condition: String(g.condition ?? '').trim(),
        precondition: g.precondition ? String(g.precondition).trim() : null,
        // `base_time` is duration x 10000 seconds; -1 marks a permanent/passive effect.
        baseDurationSeconds: g.base_time === -1 ? -1 : g.base_time / 10000,
        cooldownSeconds: g.cd != null ? g.cd / 10000 : null,
        durationScaling: groupDurationScaling(utSkill, g),
        effects: (g.effects ?? [])
          .map((e) => ({
            kind: EFFECT_TYPES[e.type] ?? `unknown_${e.type}`,
            rawType: e.type,
            rawValue: e.value,
            target: effectTarget(utSkill, g, e, isDebuff),
            scaling: effectScaling(utSkill, g, e),
          }))
          .filter((e) => !e.kind.startsWith('unknown_')),
      }))
      .filter((g) => g.condition.length > 0 && g.effects.length > 0);

  /**
   * Wit-check flag. Upstream value when known; otherwise: uniques never roll, and a
   * fully passive skill (every group permanent) is applied from the gate without a
   * roll. Checked against uma-tools' Global table: every non-passive white/gold
   * skill there is 1 and every passive one is 0, bar three exceptions.
   */
  const wisdomCheckFor = (utSkill, rarity, isPassive) => {
    if (utSkill) return utSkill.wisdomCheck === 1;
    inferredEngineCount += 1;
    if (rarity === 'unique' || rarity === 'unique_upgraded' || rarity === 'evolution') return false;
    return !isPassive;
  };

  for (const raw of rawSkills) {
    const rarity = rarityLabel(raw.rarity);
    const name = raw.name_en || raw.enname;

    if (!isGlobal(raw.unreleased)) {
      excludedSkills.push({
        id: raw.id,
        name: name || raw.jpname,
        rarity: rarity ?? `raw_${raw.rarity}`,
        reason: `not released on the Global server (unreleased: ${JSON.stringify(raw.unreleased)})`,
      });
      continue;
    }

    if (!rarity || !name) {
      reject('skill', raw.id, `unmapped rarity ${raw.rarity} or missing English name`);
      continue;
    }

    const view = globalView(raw);
    const utSkill = utSkills[String(raw.id)] ?? null;
    const groups = normalizeGroups(view.conditionGroups, utSkill, isOpponentDebuff(view.tags));

    if (!groups.length) {
      const kinds = (raw.condition_groups ?? [])
        .flatMap((g) => g.effects ?? [])
        .map((e) => EFFECT_TYPES[e.type] ?? `unknown_${e.type}`);
      const nonRaceOnly = kinds.length > 0 && kinds.every((k) => k.startsWith('carnival_'));
      if (nonRaceOnly) {
        excludedSkills.push({
          id: raw.id,
          name,
          rarity,
          reason: 'not a race skill (Racing Carnival bonus only)',
        });
      } else {
        reject('skill', raw.id, 'no usable condition group (unknown effect types or empty condition)');
      }
      continue;
    }

    const tags = view.tags;
    const effectKindSet = new Set(groups.flatMap((g) => g.effects.map((e) => e.kind)));
    const isPassive = groups.every((g) => g.baseDurationSeconds === -1);
    const isDebuff = isOpponentDebuff(tags);

    const classification = {
      tags,
      effects: groups.flatMap((g) => g.effects),
      isPassive,
      effectKinds: [...effectKindSet],
    };

    // Negative skills (the "x" aptitudes, bad conditions and purple negatives) are
    // dropped here, at the earliest possible point, so they can never reach the
    // simulation, the rankings, the filters or a character score.
    if (isNegativeSkill(classification)) {
      excludedSkills.push({
        id: raw.id,
        name,
        rarity,
        reason: 'negative skill (acquired flaw / purple negative) - excluded from every ranking',
      });
      negativeSkillCount += 1;
      continue;
    }

    const prerequisiteIds = prerequisiteChain(raw);
    const baseCost = typeof raw.cost === 'number' ? raw.cost : null;
    const prereqCost = prerequisiteIds.reduce((sum, id) => sum + (skillById.get(id)?.cost ?? 0), 0);
    const totalCost = baseCost == null ? null : baseCost + prereqCost;

    const record = {
      id: raw.id,
      name,
      description: raw.desc_en || raw.endesc,
      conditionText: raw.endesc,
      rarity,
      iconId: view.iconId,
      iconUrl: skillIconUrl(view.iconId),
      baseCost,
      totalCost,
      prerequisiteIds,
      upgradeOfId: raw.pre_evo?.old ?? upgradeBaseOf(raw) ?? null,
      tags,
      tagLabels: tags.map((t) => SKILL_TAGS[t]).filter(Boolean),
      runningStyleRestriction: tags.map((t) => RUNNING_STYLE_BY_TAG[t]).filter(Boolean),
      surfaceRestriction: tags.map((t) => SURFACE_BY_TAG[t]).filter(Boolean),
      distanceRestriction: tags.map((t) => DISTANCE_CATEGORY_BY_SKILL_TAG[t]).filter(Boolean),
      effectKinds: [...effectKindSet],
      isPassive,
      isDebuff,
      isNegativeSkill: false,
      wisdomCheck: wisdomCheckFor(utSkill, rarity, isPassive),
      engineSource: utSkill ? 'uma-tools' : 'inferred',
      engineTags: utSkill && Array.isArray(utSkill.tags) && utSkill.tags.length ? utSkill.tags : [-1],
      isInheritedUnique: false,
      inheritedFromSkillId: null,
      usesGlobalOverride: view.overridden,
      category: classifySkill(classification),
      filterBuckets: skillFilterBuckets(classification),
      ownerCardIds: view.ownerCardIds,
      globalAvailable: true,
      sourceUrl: sourceUrlFor('skills'),
      lastVerifiedAt,
      conditionGroups: groups,
    };

    // GameTora publishes no per-skill page, so a skill is only linkable when a
    // canonical page documents it: a unique skill points at the character card
    // that owns it. Resolved after the character pass, below.
    pendingSkillLinks.push(record);

    const parsed = SkillSchema.safeParse(record);
    if (!parsed.success) {
      reject('skill', raw.id, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      continue;
    }
    skills.push(record);
    if (view.overridden) globalOverrideCount += 1;

    /* ---- inheritable copy of a unique skill ---- */
    // A unique skill can be passed down through inheritance as a weaker, purchasable
    // version with its own id, SP cost and (often weaker) effect values. It is a
    // separate learnable skill, so it gets its own record.
    const gene = globalGeneView(raw);
    if (gene && gene.name && !emittedGeneIds.has(gene.id)) {
      emittedGeneIds.add(gene.id);
      const utGene = utSkills[String(gene.id)] ?? null;
      const geneGroups = normalizeGroups(gene.conditionGroups, utGene, isDebuff);
      if (geneGroups.length) {
        const geneKinds = new Set(geneGroups.flatMap((g) => g.effects.map((e) => e.kind)));
        const genePassive = geneGroups.every((g) => g.baseDurationSeconds === -1);
        const geneClassification = {
          tags,
          effects: geneGroups.flatMap((g) => g.effects),
          isPassive: genePassive,
          effectKinds: [...geneKinds],
        };
        if (!isNegativeSkill(geneClassification)) {
          const geneRecord = {
            ...record,
            id: gene.id,
            name: gene.name,
            description: gene.description || record.description,
            conditionText: gene.description || record.conditionText,
            rarity: 'inherited_unique',
            iconId: gene.iconId,
            iconUrl: skillIconUrl(gene.iconId),
            baseCost: gene.cost,
            totalCost: gene.cost,
            prerequisiteIds: [],
            upgradeOfId: null,
            effectKinds: [...geneKinds],
            isPassive: genePassive,
            wisdomCheck: wisdomCheckFor(utGene, 'inherited_unique', genePassive),
            engineSource: utGene ? 'uma-tools' : 'inferred',
            engineTags: utGene && Array.isArray(utGene.tags) && utGene.tags.length ? utGene.tags : [-1],
            isInheritedUnique: true,
            inheritedFromSkillId: gene.parentId,
            usesGlobalOverride: gene.overridden,
            category: classifySkill(geneClassification),
            filterBuckets: skillFilterBuckets(geneClassification),
            conditionGroups: geneGroups,
          };
          const geneParsed = SkillSchema.safeParse(geneRecord);
          if (geneParsed.success) {
            pendingSkillLinks.push(geneRecord);
            skills.push(geneRecord);
            inheritedUniqueCount += 1;
            if (gene.overridden) globalOverrideCount += 1;
          } else {
            reject('skill', gene.id, geneParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
          }
        }
      }
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));

  const globalSkillIds = new Set(skills.map((s) => s.id));

  /* ------------------------------------------------------- characters */

  const charById = new Map(rawCharacters.map((c) => [c.char_id, c]));
  const characters = [];
  const excludedCharacters = [];
  const missingCharacterUrls = [];

  for (const card of rawCards) {
    const base = charById.get(card.char_id);
    const name = card.name_en || base?.en_name;
    if (!name) {
      reject('character', card.card_id, 'missing English character name');
      continue;
    }

    if (!card.release_en || base?.playable_en === false) {
      excludedCharacters.push({
        cardId: card.card_id,
        name,
        reason: 'no Global release date on this character card',
      });
      continue;
    }

    const aptitudeValues = card.aptitude ?? [];
    if (aptitudeValues.length !== APTITUDE_ORDER.length) {
      reject('character', card.card_id, `aptitude array has ${aptitudeValues.length} entries, expected 10`);
      continue;
    }
    const aptitude = Object.fromEntries(APTITUDE_ORDER.map((k, i) => [k, aptitudeValues[i]]));

    const uniqueSkillIds = (card.skills_unique ?? []).filter((id) => globalSkillIds.has(id));
    if (!uniqueSkillIds.length) {
      reject('character', card.card_id, 'no Global-available unique skill');
      continue;
    }
    // Characters with the unique-skill upgrade own both the base (rarity 3) and the
    // upgraded (rarity 4) version. The upgraded one is what a maxed build actually uses.
    const primaryUniqueSkillId = uniqueSkillIds
      .slice()
      .sort((a, b) => (rawSkills.find((s) => s.id === b).rarity) - (rawSkills.find((s) => s.id === a).rarity))[0];

    // Canonical GameTora page, built from the card's own `url_name` slug - never
    // from the English display name - and validated before it is stored.
    const url = characterUrl(card.url_name);
    if (card.url_name && !url) {
      reject('character', card.card_id, `unusable GameTora url_name "${card.url_name}"`);
      continue;
    }
    if (url && !isValidGameToraUrl(url)) {
      reject('character', card.card_id, `built an invalid GameTora URL: ${url}`);
      continue;
    }
    if (!url) missingCharacterUrls.push(card.card_id);

    const record = {
      cardId: card.card_id,
      charId: card.char_id,
      name,
      title: card.title_en_gl ?? card.title ?? '',
      rarity: card.rarity,
      imageUrl: cardImageUrl(card.char_id, card.card_id),
      ...(url ? { gameToraUrl: url } : {}),
      aptitude,
      uniqueSkillIds,
      primaryUniqueSkillId,
      awakeningSkillIds: (card.skills_awakening_en ?? card.skills_awakening ?? []).filter((id) =>
        globalSkillIds.has(id),
      ),
      innateSkillIds: (card.skills_innate ?? []).filter((id) => globalSkillIds.has(id)),
      evolutionSkillIds: (card.skills_evo ?? [])
        .map((e) => e.new)
        .filter((id) => globalSkillIds.has(id)),
      globalAvailable: true,
      globalReleaseDate: card.release_en,
      sourceUrl: sourceUrlFor('character-cards'),
      lastVerifiedAt,
    };

    const parsed = CharacterSchema.safeParse(record);
    if (!parsed.success) {
      reject(
        'character',
        card.card_id,
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
      continue;
    }
    characters.push(parsed.data);
  }
  characters.sort((a, b) => a.name.localeCompare(b.name) || a.cardId - b.cardId);

  /* -------------------------------------------- skill -> GameTora links */

  // GameTora has no per-skill page (its skill list renders no anchors and honours
  // no deep-link parameter). The only canonical page that documents a skill is the
  // owning character card's page, which applies to unique skills. Every other skill
  // deliberately gets no URL and stays non-clickable.
  const characterUrlByCardId = new Map(
    characters.filter((c) => c.gameToraUrl).map((c) => [c.cardId, c.gameToraUrl]),
  );
  let linkedSkills = 0;
  for (const record of pendingSkillLinks) {
    if (
      record.rarity !== 'unique' &&
      record.rarity !== 'unique_upgraded' &&
      record.rarity !== 'inherited_unique'
    ) {
      continue;
    }
    const ownerUrl = record.ownerCardIds.map((id) => characterUrlByCardId.get(id)).find(Boolean);
    if (!ownerUrl || !isValidGameToraUrl(ownerUrl)) continue;
    record.gameToraUrl = ownerUrl;
    record.gameToraUrlKind = 'character';
    linkedSkills += 1;
  }

  /* ------------------------------------------------------- conditions */

  const conditions = rawConditions
    .filter((c) => c.name && c.desc)
    .map((c) => ({
      name: c.name,
      description: c.desc,
      example: c.example ?? '',
      exampleMeaning: c.example_meaning ?? '',
      note: c.note ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  /* ---------------------------------------------------- event presets */

  // Champions Meeting cups are zodiac-named. Global runs the same sequence as Japan
  // with the same ids (verified: ids 1-16 match on track/distance/surface/direction),
  // so an id Japan has run but Global has not is a genuine upcoming Global cup.
  const ZODIAC_EN = {
    'ヴァルゴ': 'Virgo',
    'ライブラ': 'Libra',
    'スコーピオ': 'Scorpio',
    'サジタリウス': 'Sagittarius',
    'カプリコーン': 'Capricorn',
    'アクエリアス': 'Aquarius',
    'ピスケス': 'Pisces',
    'アリエス': 'Aries',
    'タウラス': 'Taurus',
    'ジェミニ': 'Gemini',
    'キャンサー': 'Cancer',
    'レオ': 'Leo',
  };
  const CONDITION_NAMES = { 1: 'firm', 2: 'good', 3: 'soft', 4: 'heavy' };
  const WEATHER_NAMES = { 1: 'sunny', 2: 'cloudy', 3: 'rainy', 4: 'snowy' };
  const SEASON_NAMES = { 1: 'spring', 2: 'summer', 3: 'autumn', 4: 'winter', 5: 'sakura' };

  const cupNameEn = (raw) => {
    // Printable ASCII means the name is already the English one; leave it alone.
    if (/^[\x20-\x7e]+$/.test(raw)) return raw;
    for (const [jp, en] of Object.entries(ZODIAC_EN)) {
      if (raw.includes(jp)) return `${en} Cup`;
    }
    return raw;
  };

  /** Resolve a cup's race definition to one of our normalized courses. */
  const resolveCourse = (race) => {
    const surface = SURFACE[race.ground];
    const direction = DIRECTION[race.turn];
    const matches = courses.filter(
      (c) => c.trackId === Number(race.track) && c.distance === race.distance && c.surface === surface,
    );
    if (!matches.length) return null;
    return matches.find((c) => c.direction === direction) ?? matches[0];
  };

  const globalCmIds = new Set(rawCmGlobal.map((c) => c.id));
  const highestGlobalCmId = Math.max(0, ...rawCmGlobal.map((c) => c.id));

  const championsMeetings = rawCmJp
    .filter((c) => c.race)
    .map((c) => {
      const course = resolveCourse(c.race);
      const released = globalCmIds.has(c.id);
      const globalEntry = rawCmGlobal.find((g) => g.id === c.id);
      return {
        kind: 'champions-meeting',
        id: c.id,
        name: released && globalEntry ? globalEntry.name : cupNameEn(c.name),
        status: released ? 'released-on-global' : 'upcoming-on-global',
        courseId: course ? course.id : null,
        courseName: course ? course.name : null,
        trackId: Number(c.race.track),
        distance: c.race.distance,
        surface: SURFACE[c.race.ground] ?? null,
        direction: DIRECTION[c.race.turn] ?? null,
        trackCondition: CONDITION_NAMES[c.race.condition] ?? 'firm',
        weather: WEATHER_NAMES[c.race.weather] ?? 'sunny',
        season: SEASON_NAMES[c.race.season] ?? 'spring',
        startsAt: released && globalEntry ? globalEntry.start : null,
        endsAt: released && globalEntry ? globalEntry.end : null,
        sourceUrl: `${SOURCE}/events/champions-meeting?cm=${c.id}`,
      };
    })
    .filter((c) => c.courseId !== null);

  const upcomingCm = championsMeetings.filter((c) => c.status === 'upcoming-on-global');

  // Deliberately carries no build timestamp: meta.json already records both
  // `generatedAt` and `dataFetchedAt`, and a timestamp here would make this file
  // differ on every rebuild, so the scheduled refresh workflow could never tell a
  // real data change from a no-op re-run.
  const eventPresets = {
    note:
      'Champions Meeting cups run in the same order on Global as in Japan (ids 1-16 verified identical), ' +
      'so a cup Japan has already run but Global has not is a genuine preview of an upcoming Global cup.',
    championsMeeting: {
      available: true,
      highestGlobalId: highestGlobalCmId,
      firstUpcomingId: upcomingCm.length ? upcomingCm[0].id : null,
      entries: championsMeetings,
      sourceUrl: `${SOURCE}/events/champions-meeting`,
    },
    leagueOfHeroes: {
      available: false,
      // GameTora's League of Heroes page is a static explainer image; it loads no
      // schedule payload and the data manifest has no league-of-heroes key, so there
      // is nothing to build presets from. Recorded rather than invented.
      reason:
        'GameTora publishes no structured League of Heroes schedule - its page is a static image and the ' +
        'data manifest has no matching key. The event has also not run on Global yet.',
      sourceUrl: `${SOURCE}/events/league-of-heroes`,
      entries: [],
    },
  };

  /* ------------------------------------------------------------ audit */

  const audit = auditCourses(courses);
  const auditErrors = audit.issues.filter((i) => i.severity === 'error');
  const auditWarnings = audit.issues.filter((i) => i.severity === 'warning');

  /* ------------------------------------------------------------ write */

  const evolutionAvailable = skills.some((s) => s.rarity === 'evolution');

  const outMeta = {
    generatedAt: new Date().toISOString(),
    dataFetchedAt: lastVerifiedAt,
    server: 'Global (EN)',
    source: {
      name: 'GameTora',
      homepage: SOURCE,
      manifest: meta.manifestUrl,
      documents: meta.documents,
    },
    counts: {
      courses: courses.length,
      skills: skills.length,
      characters: characters.length,
      conditions: conditions.length,
      excludedCourses: excludedCourses.length,
      excludedSkills: excludedSkills.length,
      excludedCharacters: excludedCharacters.length,
      excludedNegativeSkills: negativeSkillCount,
      championsMeetingPresets: championsMeetings.length,
      upcomingChampionsMeetings: upcomingCm.length,
      inheritedUniqueSkills: inheritedUniqueCount,
      skillsUsingGlobalOverride: globalOverrideCount,
      charactersWithGameToraUrl: characters.filter((c) => c.gameToraUrl).length,
      skillsWithGameToraUrl: linkedSkills,
      rejected: rejected.length,
    },
    courseAudit: {
      checked: audit.checked,
      errors: auditErrors.length,
      warnings: auditWarnings.length,
      issues: audit.issues,
    },
    evolutionSkillsAvailableOnGlobal: evolutionAvailable,
    notes: [
      'Global availability for skills comes from GameTora\'s per-server `unreleased` list.',
      'Global availability for characters comes from the `release_en` field on the character card.',
      'Global availability for racecourses is derived from races that are released on the Global server.',
      'Distance categories come from src/courses/distanceCategory.ts (Sprint <=1400, Mile <=1800, Medium <=2400, Long >2500-), not from GameTora\'s numeric enum.',
      'Negative skills (x aptitudes, bad conditions, purple negatives) are dropped at normalization and never enter any ranking.',
      "Skill values come from GameTora's per-server `loc.en` block where one exists, so Global keeps its own balance when Japan has been rebalanced (e.g. Certain Victory).",
      'Each unique skill also ships its inheritable copy as a separate 200 SP skill with its own (usually weaker) values.',
      'GameTora publishes no per-skill page, so only unique skills carry a link (to the owning character card page).',
      evolutionAvailable
        ? 'Evolution skills are live on Global and are included in rankings.'
        : 'No evolution skill is released on Global yet, so character scores currently contain the unique skill only.',
    ],
  };

  await writeFile(path.join(OUT, 'courses.json'), JSON.stringify(courses), 'utf8');
  await writeFile(path.join(OUT, 'skills.json'), JSON.stringify(skills), 'utf8');
  await writeFile(path.join(OUT, 'characters.json'), JSON.stringify(characters), 'utf8');
  await writeFile(path.join(OUT, 'skill-conditions.json'), JSON.stringify(conditions), 'utf8');
  await writeFile(path.join(OUT, 'event-presets.json'), JSON.stringify(eventPresets), 'utf8');
  await writeFile(
    path.join(OUT, 'excluded-non-global.json'),
    JSON.stringify({
      note: 'Developer-only. Never merged into Global rankings.',
      courses: excludedCourses,
      skills: excludedSkills,
      characters: excludedCharacters,
    }),
    'utf8',
  );
  await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(outMeta, null, 2), 'utf8');

  console.log('normalized ->');
  console.log(`  courses     ${courses.length} (excluded ${excludedCourses.length})`);
  console.log(
    `  skills      ${skills.length} (excluded ${excludedSkills.length}, of which ${negativeSkillCount} negative)`,
  );
  console.log(
    `    inherited uniques ${inheritedUniqueCount} - Global-specific values on ${globalOverrideCount} skills`,
    `    engine metadata (target / wit check): ${skills.length - inferredEngineCount} from uma-tools, ${inferredEngineCount} inferred`,
  );
  console.log(`  characters  ${characters.length} (excluded ${excludedCharacters.length})`);
  console.log(`  conditions  ${conditions.length}`);
  console.log(
    `  presets     ${championsMeetings.length} Champions Meeting cups (${upcomingCm.length} upcoming on Global, ` +
      `next id ${upcomingCm.length ? upcomingCm[0].id : '-'}) - League of Heroes: no data published`,
  );
  console.log(
    `  GameTora links: ${characters.filter((c) => c.gameToraUrl).length} characters, ${linkedSkills} skills` +
      (missingCharacterUrls.length ? ` (${missingCharacterUrls.length} character(s) without a slug)` : ''),
  );
  console.log(`  evolution skills on Global: ${evolutionAvailable ? 'yes' : 'no'}`);

  console.log(`\ncourse audit: ${audit.checked} checked, ${auditErrors.length} error(s), ${auditWarnings.length} warning(s)`);
  if (audit.issues.length) console.log(formatCourseIssues(audit.issues));

  if (auditErrors.length && strict) {
    console.error('\ncourse audit reported errors and --strict was set');
    process.exit(1);
  }

  if (rejected.length) {
    console.warn(`\n${rejected.length} record(s) rejected by validation:`);
    for (const r of rejected.slice(0, 25)) console.warn(`  - ${r.kind} ${r.id}: ${r.reason}`);
    if (rejected.length > 25) console.warn(`  ... and ${rejected.length - 25} more`);
    if (strict) process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nbuild failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
