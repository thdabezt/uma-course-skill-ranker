'use client';

import { useMemo, useState } from 'react';

import { SPURT_RATE_TARGETS, type StaminaResult } from '@/analysis/stamina';
import type { SimulationOptions } from '@/engine/compare';
import { RUNNING_STYLE_LABELS, type RunnerConfig } from '@/simulation/config';
import type { Skill } from '@/simulation/types';
import { RunnerPanel } from './RunnerPanel';
import { RarityChip } from './skillRows';
import { Badge, Panel, Spinner, Toggle, Tooltip, ErrorState } from './ui';

export interface StaminaView {
  result: StaminaResult;
  sweep: { stamina: number; fullSpurtRate: number; remainingHpMedian: number }[];
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'accent' | 'warn' | 'bad' }) {
  const color = tone === 'accent' ? 'text-[var(--color-accent)]' : tone === 'warn' ? 'text-[var(--color-warn)]' : tone === 'bad' ? 'text-[var(--color-bad)]' : '';
  const body = (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2">
      <div className="text-[10px] tracking-wide uppercase text-[var(--color-ink-dim)]">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
  return hint ? <Tooltip label={hint}>{body}</Tooltip> : body;
}

export function StaminaTab({
  runner,
  onRunnerChange,
  options,
  onOptionsChange,
  forceFullSpurt,
  onForceFullSpurtChange,
  candidateSkills,
  selectedSkillIds,
  onSelectedSkillsChange,
  view,
  computing,
  error,
}: {
  runner: RunnerConfig;
  onRunnerChange: (r: RunnerConfig) => void;
  options: SimulationOptions;
  onOptionsChange: (o: SimulationOptions) => void;
  forceFullSpurt: boolean;
  onForceFullSpurtChange: (v: boolean) => void;
  candidateSkills: Skill[];
  selectedSkillIds: number[];
  onSelectedSkillsChange: (ids: number[]) => void;
  view: StaminaView | null;
  computing: boolean;
  error: string | null;
}) {
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const selected = useMemo(() => candidateSkills.filter((s) => selectedSkillIds.includes(s.id)), [candidateSkills, selectedSkillIds]);
  const choices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidateSkills
      .filter((s) => (showAll || s.category === 'recovery' || s.effectKinds.includes('stamina_stat')) && !selectedSkillIds.includes(s.id))
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [candidateSkills, search, showAll, selectedSkillIds]);

  const r = view?.result ?? null;
  const rate = r ? r.fullSpurtRate : 0;
  const rateTone = rate >= 0.95 ? 'accent' : rate >= 0.8 ? 'warn' : 'bad';

  return (
    <div className="space-y-4">
      <RunnerPanel runner={runner} onChange={onRunnerChange} options={options} onOptionsChange={onOptionsChange} />

      <Panel title="Skills carried into the race" subtitle="Recovery skills change the answer the most; any skill can be added to see its stamina cost.">
        <div className="flex flex-wrap gap-1.5">
          {selected.length === 0 && <span className="text-xs text-[var(--color-ink-dim)]">No skills selected.</span>}
          {selected.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectedSkillsChange(selectedSkillIds.filter((id) => id !== s.id))}
              className="inline-flex items-center gap-1 rounded border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 px-2 py-0.5 text-xs"
              title="Remove"
            >
              {s.name} <span className="opacity-60">x</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Add a skill"
            aria-label="Add a skill"
            className="min-w-[12rem] flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <Toggle label="Show every skill, not only recovery" checked={showAll} onChange={setShowAll} />
        </div>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {choices.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelectedSkillsChange([...selectedSkillIds, s.id])}
                className="inline-flex items-center gap-1 rounded border border-[var(--color-line)] px-2 py-0.5 text-xs hover:border-[var(--color-accent)]"
              >
                {s.name} <RarityChip skill={s} />
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Stamina calculation"
        subtitle={`Monte Carlo over the whole race for a ${RUNNING_STYLE_LABELS[runner.runningStyle]}, including rushing, position keep, spot struggle, downhill mode and the skills above.`}
        right={
          <Toggle
            label="Force full spurt"
            checked={forceFullSpurt}
            onChange={onForceFullSpurtChange}
            title="Spurt at full speed from the 2/3 mark even when HP is short, so the remaining HP shows the shortfall instead of a slower spurt hiding it."
          />
        }
      >
        {error && <ErrorState title="The stamina calculation failed" detail={error} />}
        {computing && !r && <Spinner label="Simulating the race..." />}
        {r && (
          <div className={`space-y-4 ${computing ? 'opacity-60' : ''}`}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Card label="Full spurt rate" value={`${Math.round(rate * 100)}%`} tone={rateTone} hint="Share of simulated races in which the runner could afford a full-speed last spurt from the 2/3 mark. 87% or better is usually considered fine; aim higher for finals." />
              <Card label="Max HP" value={`${Math.round(r.maxHp)}`} hint="0.8 x style coefficient x stamina + distance" />
              <Card label="HP left (median)" value={`${Math.round(r.remainingHp.median)}`} hint={`min ${Math.round(r.remainingHp.min)}, max ${Math.round(r.remainingHp.max)}, mean ${Math.round(r.remainingHp.mean)}. Negative = the forced full spurt was not affordable.`} tone={r.remainingHp.median < 0 ? 'bad' : undefined} />
              <Card label="HP required (median)" value={`${Math.round(r.requiredHp.median)}`} hint="HP the race consumed up to the 2/3 mark plus a full-speed spurt to the line." />
              <Card label="Rushed" value={`${Math.round(r.rushed.rate * 100)}%`} hint={`Share of races with a rush. On average a rush cost ${Math.round(r.rushed.meanHpCost)} HP.`} />
              {r.spotStruggle ? (
                <Card label="Spot struggle" value={`${Math.round(r.spotStruggle.rate * 100)}%`} hint={`Share of races with a fight for the lead. On average it cost ${Math.round(r.spotStruggle.meanHpCost)} HP.`} />
              ) : (
                <Card label="Downhill saving" value={`${Math.round(r.downhillSave.mean)}`} hint={`HP saved by downhill mode: ${Math.round(r.downhillSave.min)} to ${Math.round(r.downhillSave.max)}.`} />
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold tracking-wide uppercase text-[var(--color-ink-dim)]">Stamina needed for a full spurt</h3>
              <p className="mt-1 text-xs text-[var(--color-ink-dim)]">
                Effective stamina (after mood) such that the given share of races can afford a full-speed spurt. Read the 95% or 100% column for a build that must never run out.
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {SPURT_RATE_TARGETS.map((p) => (
                  <Card key={p} label={`${p}% of races`} value={String(r.staminaFor[p] ?? '-')} tone={p >= 95 ? 'accent' : undefined} />
                ))}
              </div>
            </div>

            {view && view.sweep.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold tracking-wide uppercase text-[var(--color-ink-dim)]">Full spurt rate by stamina</h3>
                <ul className="mt-2 space-y-1">
                  {view.sweep.map((row) => (
                    <li key={row.stamina} className="flex items-center gap-2 text-xs">
                      <span className={`w-14 text-right tabular-nums ${row.stamina === runner.stamina ? 'font-semibold' : 'text-[var(--color-ink-dim)]'}`}>{row.stamina}</span>
                      <div className="h-3 flex-1 overflow-hidden rounded bg-[var(--color-panel-2)]">
                        <div className={`h-full ${row.fullSpurtRate >= 0.95 ? 'bg-[var(--color-accent)]' : row.fullSpurtRate >= 0.8 ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-bad)]'}`} style={{ width: `${Math.round(row.fullSpurtRate * 100)}%` }} />
                      </div>
                      <span className="w-12 text-right tabular-nums">{Math.round(row.fullSpurtRate * 100)}%</span>
                      <span className="w-20 text-right tabular-nums text-[var(--color-ink-dim)]">{Math.round(row.remainingHpMedian)} HP</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {r.whatIf.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold tracking-wide uppercase text-[var(--color-ink-dim)]">What changes if</h3>
                <ul className="mt-2 grid gap-2 sm:grid-cols-3">
                  {r.whatIf.map((w) => (
                    <li key={w.label} className="rounded border border-[var(--color-line)] px-3 py-2 text-xs">
                      <div className="font-medium">{w.label}</div>
                      <div className="text-[var(--color-ink-dim)]">
                        full spurt <span className="text-[var(--color-ink)] tabular-nums">{Math.round(w.fullSpurtRate * 100)}%</span>, HP left <span className="text-[var(--color-ink)] tabular-nums">{Math.round(w.remainingHpMedian)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-[var(--color-ink-dim)]">
              <Badge>{r.samples} races</Badge> Rushing chance and downhill mode come from Wit; HP drain is 20 x (v - base + 12)^2 / 144 per second, x0.6 while pacing down, x0.4 in downhill mode, x1.6 while rushed (x1.4 / x3.6 for a front runner in a spot struggle), plus a Guts multiplier in the final leg.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
