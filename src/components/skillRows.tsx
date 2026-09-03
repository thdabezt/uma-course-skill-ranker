'use client';

import { useMemo, useState } from 'react';

import type { RarityFilter } from '@/analysis/rankSkills';
import { matchesRarity } from '@/analysis/rankSkills';
import type { Reliability, SkillAnalysis } from '@/analysis/skillAnalysis';
import { conditionDocByName } from '@/data';
import { EFFICIENCY_SP_BASIS, RUNNING_STYLE_LABELS, type RunningStyle } from '@/simulation/config';
import type { Skill } from '@/simulation/types';
import { conditionNames } from '@/skills/conditionParser';
import { describeEffect } from '@/skills/effects';
import { Badge, ExternalLink, Toggle, Tooltip } from './ui';

export interface SkillRow {
  skill: Skill;
  analysis: SkillAnalysis;
}

export const num = (v: number, digits = 2): string => (Number.isFinite(v) ? v.toFixed(digits) : '-');
export const pct = (v: number): string => `${Math.round(v * 100)}%`;
export const metres = (v: number): string => `${Math.round(v)} m`;

const RARITY_TONE: Record<string, 'neutral' | 'gold' | 'unique' | 'evolution'> = {
  normal: 'neutral',
  gold: 'gold',
  unique: 'unique',
  unique_upgraded: 'unique',
  inherited_unique: 'unique',
  evolution: 'evolution',
};

const RARITY_LABEL: Record<string, string> = {
  normal: 'White',
  gold: 'Gold',
  unique: 'Unique',
  unique_upgraded: 'Unique+',
  inherited_unique: 'Inherited',
  evolution: 'Evolution',
};

const RELIABILITY_LABEL: Record<Reliability, string> = {
  immediate: 'Fixed point',
  random: 'Random point',
  field: 'Needs the field',
  passive: 'Passive',
  never: 'Never fires',
};

const RELIABILITY_HINT: Record<Reliability, string> = {
  immediate: 'Fires at the start of its condition zone every time.',
  random: 'Fires at a random point inside its zone.',
  field: 'Depends on other runners (overtaking, blocking, nearby runners); modelled by a probability distribution.',
  passive: 'Permanent effect applied from the gate.',
  never: 'Its conditions cannot hold on this course with this runner.',
};

export function RarityChip({ skill }: { skill: Skill }) {
  return <Badge tone={RARITY_TONE[skill.rarity] ?? 'neutral'}>{RARITY_LABEL[skill.rarity] ?? skill.rarity}</Badge>;
}

export function ReliabilityChip({ reliability }: { reliability: Reliability }) {
  const tone = reliability === 'immediate' ? 'accent' : reliability === 'never' ? 'bad' : reliability === 'field' ? 'warn' : 'neutral';
  return (
    <Badge tone={tone} title={RELIABILITY_HINT[reliability]}>
      {RELIABILITY_LABEL[reliability]}
    </Badge>
  );
}

export function SkillName({ skill }: { skill: Skill }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={skill.iconUrl} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded" loading="lazy" />
      <div className="min-w-0">
        <div className="truncate font-medium">
          <ExternalLink href={skill.gameToraUrl}>{skill.name}</ExternalLink>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-[var(--color-ink-dim)]">
          <RarityChip skill={skill} />
          {skill.totalCost != null && <span>{skill.totalCost} SP</span>}
          {skill.runningStyleRestriction.length > 0 && (
            <span>{skill.runningStyleRestriction.map((s) => RUNNING_STYLE_LABELS[s as RunningStyle] ?? s).join(' / ')}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function efficiency(row: SkillRow): number | null {
  if (row.skill.totalCost == null || row.skill.totalCost <= 0) return null;
  return (row.analysis.gain.mean * EFFICIENCY_SP_BASIS) / row.skill.totalCost;
}

function ConditionText({ expression }: { expression: string }) {
  const names = conditionNames(expression);
  return (
    <div className="space-y-1">
      <code className="block text-[11px] break-all text-[var(--color-ink-dim)]">{expression}</code>
      <ul className="space-y-0.5">
        {names.map((n) => {
          const doc = conditionDocByName.get(n);
          return (
            <li key={n} className="text-[11px]">
              <span className="font-mono text-[var(--color-accent)]">{n}</span>
              {doc ? <span className="text-[var(--color-ink-dim)]"> - {doc.description}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Expanded row: where it fired, why it scored what it scored, and the raw skill data. */
export function AnalysisDetails({ row, courseDistance }: { row: SkillRow; courseDistance: number }) {
  const { skill, analysis: a } = row;
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-3 text-xs">
      <p className="text-[var(--color-ink-dim)]">{skill.description}</p>
      {a.accel && (
        <p>
          <span className="font-semibold">Acceleration timing: </span>
          {a.accel.explanation}
          {a.accel.referenceGain > 0 && (
            <span className="text-[var(--color-ink-dim)]">
              {' '}
              Reference (perfect proc at {metres(a.timing.phase2Start)}): {num(a.accel.referenceGain)} lengths.
            </span>
          )}
        </p>
      )}
      {a.speed && (
        <p>
          <span className="font-semibold">Speed value: </span>
          {a.speed.explanation}
        </p>
      )}
      {a.error && <p className="text-[var(--color-bad)]">Could not simulate: {a.error}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Fact label="Samples" value={String(a.samples)} />
        <Fact label="Fired in" value={a.activation ? pct(a.activation.rate) : '0%'} hint="Share of simulated races in which the skill activated." />
        <Fact label="Fires at" value={a.activation ? (a.reliability === 'immediate' ? metres(a.activation.meanStart) : `${metres(a.activation.minStart)} - ${metres(a.activation.maxStart)}`) : '-'} />
        <Fact label="Effect ends" value={a.activation ? metres(Math.min(courseDistance, a.activation.meanEnd)) : '-'} hint="Mean position where the effect wore off." />
        <Fact label="Zone" value={a.region ? `${metres(a.region.start)} - ${metres(a.region.end)}` : 'none'} hint="Where the skill's static conditions allow it to fire." />
        <Fact label="Offset from 2/3" value={a.timing.offsetFromPhase2 == null ? '-' : `${a.timing.offsetFromPhase2 >= 0 ? '+' : ''}${Math.round(a.timing.offsetFromPhase2)} m`} hint="Mean activation position minus the final-leg start." />
        <Fact label="Carryover" value={pct(a.timing.carryoverShare)} hint="Runs where the effect was still active at the final-leg or spurt transition." />
        <Fact label="Shadowed" value={pct(a.timing.shadowShare)} hint="Runs where it fired while still accelerating to final-leg speed." />
        <Fact label="Cut by finish" value={pct(a.timing.cutByFinishShare)} />
        <Fact label="HP cost" value={`${a.timing.hpCost >= 0 ? '' : '+'}${Math.round(-a.timing.hpCost)}`} hint="Mean HP difference at the finish (negative = costs HP)." />
        <Fact label="Full spurt rate" value={pct(a.timing.fullSpurtRate)} />
        <Fact label="Median / std" value={`${num(a.gain.median)} / ${num(a.gain.stdDev)}`} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {skill.conditionGroups.map((g, i) => (
          <div key={i} className="rounded border border-[var(--color-line)] p-2">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{skill.conditionGroups.length > 1 ? `Variant ${i + 1}` : 'Conditions'}</span>
              <span className="text-[var(--color-ink-dim)]">
                {g.baseDurationSeconds === -1 ? 'permanent' : `${g.baseDurationSeconds} s x ${(courseDistance / 1000).toFixed(1)} = ${(g.baseDurationSeconds * courseDistance / 1000).toFixed(1)} s`}
              </span>
            </div>
            <ConditionText expression={g.condition} />
            {g.precondition && (
              <div className="mt-1">
                <span className="text-[var(--color-ink-dim)]">after: </span>
                <ConditionText expression={g.precondition} />
              </div>
            )}
            <ul className="mt-1 text-[11px]">
              {g.effects.map((e, j) => (
                <li key={j}>{describeEffect(e)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const body = (
    <div className="rounded border border-[var(--color-line)] px-2 py-1">
      <div className="text-[10px] uppercase text-[var(--color-ink-dim)]">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
  return hint ? <Tooltip label={hint}>{body}</Tooltip> : body;
}

/** Filters shared by the skill tabs. */
export function useSkillFilters(rows: SkillRow[]) {
  const [rarity, setRarity] = useState<RarityFilter>('all');
  const [search, setSearch] = useState('');
  const [hideNever, setHideNever] = useState(true);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matchesRarity(r.skill, rarity)) return false;
      if (hideNever && r.analysis.reliability === 'never') return false;
      if (q && !r.skill.name.toLowerCase().includes(q) && !r.skill.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, rarity, search, hideNever]);
  return { rarity, setRarity, search, setSearch, hideNever, setHideNever, filtered };
}

export function SkillFilterBar({
  rarity,
  setRarity,
  search,
  setSearch,
  hideNever,
  setHideNever,
  count,
}: ReturnType<typeof useSkillFilters> extends infer T ? Omit<T & { count: number }, 'filtered'> : never) {
  const chip = (value: RarityFilter, label: string) => (
    <button
      type="button"
      onClick={() => setRarity(value)}
      className={`rounded-md border px-2 py-1 text-xs ${rarity === value ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-accent)]'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <div className="flex gap-1">
        {chip('all', 'All')}
        {chip('normal', 'Normal skills')}
        {chip('inherited_unique', 'Inherited uniques')}
      </div>
      <div className="min-w-[12rem] flex-1">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills"
          aria-label="Search skills"
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      <Toggle label="Hide skills that never fire here" checked={hideNever} onChange={setHideNever} />
      <span className="text-xs text-[var(--color-ink-dim)]">{count} skills</span>
    </div>
  );
}
