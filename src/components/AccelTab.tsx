'use client';

import { Fragment, useMemo } from 'react';

import type { AccelVerdict } from '@/analysis/skillAnalysis';
import { AnalysisDetails, SkillFilterBar, SkillName, TriggerChips, metres, num, pct, useSkillFilters, type SkillRow } from './skillRows';
import { Badge, EmptyState, Panel } from './ui';

const GROUPS: { verdict: AccelVerdict; title: string; hint: string; tone: 'accent' | 'gold' | 'neutral' | 'warn' | 'bad' }[] = [
  { verdict: 'perfect', title: 'Perfect procs', hint: 'Fire at the final-leg speed jump (2/3 of the distance): the entire effect goes into the acceleration that decides the race.', tone: 'accent' },
  { verdict: 'near-perfect', title: 'Near-perfect procs', hint: 'Fire within a few dozen metres of the speed jump and keep most of their value.', tone: 'gold' },
  { verdict: 'lottery', title: 'Random-zone accels', hint: 'Fire at a random point or depend on the field. Some runs land on the speed jump, most do not; the useful share tells the odds.', tone: 'neutral' },
  { verdict: 'delayed', title: 'Delayed procs', hint: 'Fire after the speed jump, when much of the acceleration is already done. Still worth something, especially for stamina-limited builds whose spurt starts late.', tone: 'warn' },
  { verdict: 'early-partial', title: 'Early procs', hint: 'Fire before the final leg; only the tail of the effect reaches the speed jump.', tone: 'warn' },
  { verdict: 'does-not-work', title: 'Does not work here', hint: 'Never fires on this course with this runner, or fires while the runner is already at cruising speed, where acceleration gains nothing.', tone: 'bad' },
  { verdict: 'accel-not-applicable', title: 'Acceleration part cannot trigger', hint: 'The skill has an acceleration variant, but only its other variant can trigger on this course.', tone: 'bad' },
];

export function AccelTab({
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
  const grouped = useMemo(() => {
    const map = new Map<AccelVerdict, SkillRow[]>();
    for (const r of filters.filtered) {
      const v = r.analysis.accel?.verdict ?? 'does-not-work';
      if (!map.has(v)) map.set(v, []);
      map.get(v)!.push(r);
    }
    for (const list of map.values()) list.sort((a, b) => b.analysis.gain.mean - a.analysis.gain.mean);
    return map;
  }, [filters.filtered]);
  const phase2 = (courseDistance * 2) / 3;

  return (
    <Panel
      title="Acceleration skills"
      subtitle={`Acceleration only helps while the runner is below its target speed, which on this course happens right after the final-leg speed jump at ${metres(phase2)}. Every skill is measured against the same effect fired exactly there.`}
    >
      <SkillFilterBar {...filters} count={filters.filtered.length} />
      {filters.filtered.length === 0 ? (
        <EmptyState title="No acceleration skill matches" hint="Loosen the filters, or wait for the analysis to finish." />
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => {
            const list = grouped.get(g.verdict) ?? [];
            if (!list.length) return null;
            return (
              <section key={g.verdict}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone={g.tone}>{g.title}</Badge>
                  <span className="text-xs text-[var(--color-ink-dim)]">{list.length}</span>
                </div>
                <p className="mb-2 text-xs text-[var(--color-ink-dim)]">{g.hint}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[52rem] border-collapse text-sm">
                    <thead className="text-left text-[11px] tracking-wide uppercase text-[var(--color-ink-dim)]">
                      <tr className="border-b border-[var(--color-line)]">
                        <th className="py-2 pr-2">Skill</th>
                        <th className="py-2 pr-2">Fires at</th>
                        <th className="py-2 pr-2 text-right" title="Mean activation position minus the final-leg start">Offset</th>
                        <th className="py-2 pr-2 text-right">Mean lengths</th>
                        <th className="py-2 pr-2 text-right">Min / max</th>
                        <th className="py-2 pr-2 text-right" title="Mean gain divided by the gain of the same effect fired exactly at the speed jump">Of perfect</th>
                        <th className="py-2 pr-2 text-right" title="Runs that kept at least half of a perfect proc">Useful runs</th>
                        <th className="py-2 pr-2">Trigger</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const a = r.analysis;
                        const open = selectedSkillId === r.skill.id;
                        const off = a.timing.offsetFromPhase2;
                        return (
                          <Fragment key={r.skill.id}>
                            <tr
                              className={`cursor-pointer border-b border-[var(--color-line)]/60 hover:bg-[var(--color-panel-2)]/60 ${open ? 'bg-[var(--color-panel-2)]' : ''}`}
                              onClick={() => onSelect(open ? null : r.skill.id)}
                            >
                              <td className="max-w-[18rem] py-2 pr-2"><SkillName skill={r.skill} /></td>
                              <td className="py-2 pr-2 tabular-nums">
                                {a.activation ? (a.reliability === 'immediate' ? metres(a.activation.meanStart) : `${metres(a.activation.minStart)} - ${metres(a.activation.maxStart)}`) : '-'}
                              </td>
                              <td className="py-2 pr-2 text-right tabular-nums">{off == null ? '-' : `${off >= 0 ? '+' : ''}${Math.round(off)} m`}</td>
                              <td className="py-2 pr-2 text-right font-semibold tabular-nums">{num(a.gain.mean)}</td>
                              <td className="py-2 pr-2 text-right tabular-nums text-[var(--color-ink-dim)]">{num(a.gain.min)} / {num(a.gain.max)}</td>
                              <td className="py-2 pr-2 text-right tabular-nums">{a.accel && a.accel.referenceGain > 0 ? pct(Math.min(1, a.accel.ratio)) : '-'}</td>
                              <td className="py-2 pr-2 text-right tabular-nums">{a.accel && a.accel.referenceGain > 0 ? pct(a.accel.usefulShare) : '-'}</td>
                              <td className="py-2 pr-2"><TriggerChips analysis={a} /></td>
                            </tr>
                            {open && (
                              <tr className="border-b border-[var(--color-line)]/60">
                                <td colSpan={8} className="py-2">
                                  <AnalysisDetails row={r} courseDistance={courseDistance} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
