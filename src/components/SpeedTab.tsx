'use client';

import { Fragment, useMemo, useState } from 'react';

import type { SpeedTier } from '@/analysis/skillAnalysis';
import { AnalysisDetails, SkillFilterBar, SkillName, TriggerChips, efficiency, metres, num, pct, useSkillFilters, type SkillRow } from './skillRows';
import { Badge, EmptyState, Panel } from './ui';

type SortKey = 'mean' | 'max' | 'efficiency' | 'carryover' | 'start';

const SORT_LABELS: Record<SortKey, string> = {
  mean: 'Mean lengths',
  max: 'Best case',
  efficiency: 'Lengths per 100 SP',
  carryover: 'Carryover',
  start: 'Activation position',
};

const TIER_TONE: Record<SpeedTier, 'accent' | 'gold' | 'neutral' | 'warn' | 'bad'> = {
  S: 'accent',
  A: 'gold',
  B: 'neutral',
  C: 'warn',
  D: 'bad',
};

const TIER_HINT = 'S: 1.5+ lengths on average, A: 1-1.5, B: 0.5-1, C: 0.15-0.5, D: below 0.15. Skills that need other runners or fire in under half of the races are capped at B.';

export function SpeedTab({
  rows,
  courseDistance,
  selectedSkillId,
  onSelect,
}: {
  rows: SkillRow[];
  courseDistance: number;
  selectedSkillId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const filters = useSkillFilters(rows);
  const [sort, setSort] = useState<SortKey>('mean');
  const [limit, setLimit] = useState(60);

  const sorted = useMemo(() => {
    const list = filters.filtered.slice();
    const key = (r: SkillRow): number => {
      switch (sort) {
        case 'mean': return r.analysis.gain.mean;
        case 'max': return r.analysis.gain.max;
        case 'efficiency': return efficiency(r) ?? -Infinity;
        case 'carryover': return r.analysis.timing.carryoverShare;
        case 'start': return -(r.analysis.activation?.meanStart ?? Infinity);
      }
    };
    return list.sort((a, b) => key(b) - key(a));
  }, [filters.filtered, sort]);

  const visible = sorted.slice(0, limit);

  return (
    <Panel
      title="Speed skills"
      subtitle="Target-speed and current-speed skills, valued in horse lengths gained over the same race without the skill. Innate uniques are ranked in the Characters tab."
      right={
        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1 text-xs"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <SkillFilterBar {...filters} count={sorted.length} />
      <p className="mb-2 text-xs text-[var(--color-ink-dim)]">
        A speed skill is worth roughly its boost times its duration. It is worth much more when the effect is still running when the final leg begins at {metres((courseDistance * 2) / 3)} (carryover: the head start persists through the whole acceleration), much less when it fires while the runner is already accelerating (shadowed), and nothing past the finish line.
      </p>
      {visible.length === 0 ? (
        <EmptyState title="No speed skill matches" hint="Loosen the filters, or wait for the analysis to finish." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead className="text-left text-[11px] tracking-wide uppercase text-[var(--color-ink-dim)]">
              <tr className="border-b border-[var(--color-line)]">
                <th className="py-2 pr-2" title={TIER_HINT}>Tier</th>
                <th className="py-2 pr-2">Skill</th>
                <th className="py-2 pr-2 text-right">Mean</th>
                <th className="py-2 pr-2 text-right">Min / max</th>
                <th className="py-2 pr-2 text-right" title="Horse lengths per 100 SP, prerequisite skills included">/100 SP</th>
                <th className="py-2 pr-2">Fires at</th>
                <th className="py-2 pr-2 text-right" title="Runs where the effect was still active at the final-leg or spurt transition">Carry</th>
                <th className="py-2 pr-2 text-right" title="Runs where it fired while the runner was still accelerating towards final-leg speed">Shadow</th>
                <th className="py-2 pr-2 text-right" title="Runs where the finish line cut the effect short">Cut</th>
                <th className="py-2 pr-2">Trigger</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const a = r.analysis;
                const open = selectedSkillId === r.skill.id;
                const eff = efficiency(r);
                return (
                  <Fragment key={r.skill.id}>
                    <tr
                      className={`cursor-pointer border-b border-[var(--color-line)]/60 hover:bg-[var(--color-panel-2)]/60 ${open ? 'bg-[var(--color-panel-2)]' : ''}`}
                      onClick={() => onSelect(open ? null : r.skill.id)}
                    >
                      <td className="py-2 pr-2">{a.speed ? <Badge tone={TIER_TONE[a.speed.tier]}>{a.speed.tier}</Badge> : '-'}</td>
                      <td className="max-w-[18rem] py-2 pr-2"><SkillName skill={r.skill} /></td>
                      <td className="py-2 pr-2 text-right font-semibold tabular-nums">{num(a.gain.mean)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-[var(--color-ink-dim)]">{num(a.gain.min)} / {num(a.gain.max)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{eff == null ? '-' : num(eff)}</td>
                      <td className="py-2 pr-2 tabular-nums">
                        {a.activation ? (a.reliability === 'immediate' ? metres(a.activation.meanStart) : `${metres(a.activation.minStart)} - ${metres(a.activation.maxStart)}`) : '-'}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{pct(a.timing.carryoverShare)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{pct(a.timing.shadowShare)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{pct(a.timing.cutByFinishShare)}</td>
                      <td className="py-2 pr-2"><TriggerChips analysis={a} /></td>
                    </tr>
                    {open && (
                      <tr className="border-b border-[var(--color-line)]/60">
                        <td colSpan={10} className="py-2">
                          <AnalysisDetails row={r} courseDistance={courseDistance} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {sorted.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + 60)}
              className="mt-3 rounded-md border border-[var(--color-line)] px-3 py-1 text-xs hover:border-[var(--color-accent)]"
            >
              Show more ({sorted.length - limit} left)
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}
