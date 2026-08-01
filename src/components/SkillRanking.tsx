'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';

import { conditionDocByName } from '@/data';
import { EFFICIENCY_SP_BASIS, SIMULATION } from '@/simulation/config';
import { GLOBAL_DATA_VERSION } from '@/simulation/globalVersion';
import type { RankedSkillView } from '@/worker/rankingProtocol';
import { describeEffect } from '@/skills/effects';
import { conditionNames } from '@/skills/conditionParser';
import { Badge, EmptyState, ExternalLink, Panel, Toggle, Tooltip } from './ui';

/** Rows added per "show more". Enough to fill a tall screen without a huge commit. */
const PAGE_SIZE = 50;

export type SkillSortKey = 'expected' | 'activated' | 'efficiency' | 'probability' | 'cost';

const SORT_LABELS: Record<SkillSortKey, string> = {
  expected: 'Expected horse lengths',
  activated: 'Horse lengths when activated',
  probability: 'Activation probability',
  efficiency: `Lengths per ${EFFICIENCY_SP_BASIS} SP`,
  cost: 'Skill point cost',
};

const CONFIDENCE_TONE: Record<string, 'accent' | 'warn' | 'bad' | 'neutral'> = {
  deterministic: 'accent',
  simulated: 'accent',
  estimated: 'warn',
  unsupported: 'bad',
};

const CONFIDENCE_LABEL: Record<string, string> = {
  deterministic: 'Exact',
  simulated: 'Simulated',
  estimated: 'Estimated',
  unsupported: 'Unsupported',
};

const EFFECT_FILTERS: { key: string; label: string }[] = [
  { key: 'speed', label: 'Speed' },
  { key: 'acceleration', label: 'Acceleration' },
  { key: 'current_speed', label: 'Current speed' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'passive', label: 'Passive' },
  { key: 'debuff', label: 'Debuff' },
];

const RARITY_FILTERS: { key: string; label: string }[] = [
  { key: 'normal', label: 'Normal' },
  { key: 'gold', label: 'Gold' },
  { key: 'unique', label: 'Unique' },
  { key: 'inherited_unique', label: 'Inherited unique' },
  { key: 'evolution', label: 'Evolution' },
];

const RARITY_TONE: Record<string, 'neutral' | 'gold' | 'unique' | 'evolution'> = {
  normal: 'neutral',
  gold: 'gold',
  unique: 'unique',
  unique_upgraded: 'unique',
  inherited_unique: 'unique',
  evolution: 'evolution',
};

const RARITY_LABEL: Record<string, string> = {
  normal: 'Normal',
  gold: 'Gold',
  unique: 'Unique',
  unique_upgraded: 'Unique+',
  inherited_unique: 'Inherited',
  evolution: 'Evolution',
};

function num(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '-';
}

function ConditionText({ expression }: { expression: string }) {
  const names = conditionNames(expression);
  return (
    <div className="space-y-1">
      <code className="block break-all text-[11px] text-[var(--color-ink-dim)]">{expression}</code>
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

function DebugBreakdown({ item }: { item: RankedSkillView }) {
  const { evaluation, skill } = item;
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-3 text-xs">
      <div>
        <h4 className="mb-1 font-semibold">Why this number</h4>
        <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-ink-dim)]">
          {evaluation.explanations.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>

      {evaluation.groups.map((g, gi) => (
        <div
          key={gi}
          className={`rounded border p-2 ${g.selected ? 'border-[var(--color-accent)]' : 'border-[var(--color-line)] opacity-70'}`}
        >
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold">Alternative {gi + 1}</span>
            {g.selected ? (
              <Badge tone="accent">Selected</Badge>
            ) : (
              <Badge tone="neutral" title={g.rejectionReason ?? undefined}>
                Rejected
              </Badge>
            )}
            <Badge>
              {g.durationSeconds === Infinity ? 'Passive' : `${num(g.durationSeconds, 2)} s duration`}
            </Badge>
            <Badge tone={g.activation.possible ? 'accent' : 'bad'}>
              {g.activation.possible ? 'Can activate' : 'Cannot activate'}
            </Badge>
            {g.activation.isEstimate && <Badge tone="warn">Estimate</Badge>}
          </div>
          {!g.selected && g.rejectionReason && (
            <div className="mb-1 text-[11px] text-[var(--color-ink-dim)]">
              Not used: {g.rejectionReason}
            </div>
          )}

          <div className="mb-2 grid gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-0.5 text-[10px] tracking-wide uppercase text-[var(--color-ink-dim)]">
                Activation condition
              </div>
              <ConditionText expression={g.condition} />
            </div>
            {g.precondition && (
              <div>
                <div className="mb-0.5 text-[10px] tracking-wide uppercase text-[var(--color-ink-dim)]">
                  Precondition
                </div>
                <ConditionText expression={g.precondition} />
              </div>
            )}
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {g.activation.windows.map((w, i) => (
              <Badge key={i}>
                {Math.round(w.start)} - {Math.round(w.end)} m
              </Badge>
            ))}
            {g.activation.randomWithinWindow && <Badge tone="warn">Random position</Badge>}
          </div>

          {g.samples.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-[11px]">
                <thead className="text-[var(--color-ink-dim)]">
                  <tr className="text-left">
                    <th className="py-1 pr-2">Activation position</th>
                    <th className="py-1 pr-2">Baseline finish</th>
                    <th className="py-1 pr-2">Skill finish</th>
                    <th className="py-1 pr-2">Time saved</th>
                    <th className="py-1 pr-2">Metres gained</th>
                    <th className="py-1 pr-2">Horse lengths</th>
                    <th className="py-1 pr-2">Effective duration</th>
                    <th className="py-1 pr-2">Wasted duration</th>
                    <th className="py-1 pr-2">Stamina left</th>
                    <th className="py-1 pr-2">Runs</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {g.samples.map((s, i) => (
                    <tr key={i} className="border-t border-[var(--color-line)]">
                      <td className="py-1 pr-2">{s.activationMeters} m</td>
                      <td className="py-1 pr-2">{num(evaluation.baselineFinishTimeSeconds, 3)} s</td>
                      <td className="py-1 pr-2">{num(s.skillFinishTimeSeconds, 3)} s</td>
                      <td className="py-1 pr-2">{num(s.timeSavedSeconds, 3)} s</td>
                      <td className="py-1 pr-2">{num(s.metersGained, 2)} m</td>
                      <td className="py-1 pr-2">{num(s.horseLengths, 3)}</td>
                      <td className="py-1 pr-2">{num(s.effectiveDurationSeconds, 2)} s</td>
                      <td className="py-1 pr-2">{num(s.wastedDurationSeconds, 2)} s</td>
                      <td className="py-1 pr-2">{num(s.hpRemainingFraction * 100, 1)}%</td>
                      <td className="py-1 pr-2">{s.runs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-2 text-[11px] text-[var(--color-ink-dim)]">
            Activation probability {num(g.activation.probability * 100, 0)}% - useful duration{' '}
            {num(g.usefulDurationRatio * 100, 0)}% - wasted {num(g.wastedDurationRatio * 100, 0)}%
          </div>
        </div>
      ))}

      <div className="text-[11px] text-[var(--color-ink-dim)]">
        Effects: {skill.conditionGroups[0]?.effects.map(describeEffect).join(', ')}
        {skill.prerequisiteIds.length > 0 && (
          <>
            {' - '}Total cost includes {skill.prerequisiteIds.length} prerequisite skill
            {skill.prerequisiteIds.length > 1 ? 's' : ''}
          </>
        )}
      </div>
      <div className="space-y-0.5 text-[11px] text-[var(--color-ink-dim)]">
        <div>
          Bashin method: <span className="font-mono">{evaluation.debug.horseLengthMethod}</span> at{' '}
          {evaluation.debug.metresPerHorseLength} m per length - simulation step{' '}
          {num(SIMULATION.frameSeconds, 4)} s
        </div>
        <div>
          Alternative {evaluation.debug.selectedAlternative + 1} of {evaluation.debug.alternativeCount}{' '}
          selected
          {evaluation.debug.rejectedAlternatives.length > 0 &&
            ` - rejected: ${evaluation.debug.rejectedAlternatives
              .map((r) => `#${r.priority + 1} (${r.reason})`)
              .join('; ')}`}
        </div>
        <div>
          Seed <span className="font-mono">{evaluation.debug.seed}</span> - activation model{' '}
          <span className="font-mono">{evaluation.debug.activationModel}</span> - {evaluation.debug.activations}{' '}
          activations in {evaluation.debug.eligibleRuns} eligible simulations vs{' '}
          {evaluation.debug.opponentsSimulated} opponents
        </div>
        <div>
          Value when activated {num(evaluation.activatedBashin, 3)} x rate{' '}
          {num(evaluation.activationProbability * 100, 0)}% = expected {num(evaluation.expectedBashin, 3)} - sd{' '}
          {num(evaluation.debug.stdDev, 3)} - 95% CI {num(evaluation.debug.ci95[0], 3)} to{' '}
          {num(evaluation.debug.ci95[1], 3)}
          {evaluation.debug.sampling ? ` - stopped: ${evaluation.debug.sampling.stoppedBecause}` : ''}
        </div>
        <div>
          Baseline stamina left {num(evaluation.debug.baselineHpRemaining * 100, 1)}% - last spurt from{' '}
          {evaluation.debug.baselineSpurtStart == null
            ? '-'
            : `${Math.round(evaluation.debug.baselineSpurtStart)} m`}{' '}
          ({evaluation.debug.baselineFullSpurt ? 'full spurt' : 'reduced spurt'})
        </div>
        <div>
          Global data {GLOBAL_DATA_VERSION.dataUpdatedAt} - mechanics reference{' '}
          <span className="font-mono">{GLOBAL_DATA_VERSION.umalatorReferenceCommit?.slice(0, 10)}</span>
        </div>
      </div>
    </div>
  );
}

export function SkillRanking({
  ranked,
  selectedSkillId,
  onSelectSkill,
}: {
  ranked: RankedSkillView[];
  selectedSkillId?: number | null;
  onSelectSkill?: (id: number | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SkillSortKey>('expected');
  const [ascending, setAscending] = useState(false);
  const [effectFilters, setEffectFilters] = useState<string[]>([]);
  const [rarityFilters, setRarityFilters] = useState<string[]>([]);
  const [hideInactive, setHideInactive] = useState(true);
  const [hideInherited, setHideInherited] = useState(false);
  const expanded = selectedSkillId ?? null;
  const setExpanded = (id: number | null) => onSelectSkill?.(id);

  /**
   * How many rows are actually in the DOM.
   *
   * Rendering every filtered row put ~360 rows and ~10,600 elements on the page -
   * 91% of the document - and every unrelated state change had to reconcile all of
   * them. The table is sorted by value and people read the top of it, so a
   * "show more" control costs nothing in practice. The in-panel search is the
   * discovery path for anything further down.
   */
  const [visible, setVisible] = useState(PAGE_SIZE);

  // A deferred query keeps typing responsive: the filter below lowercases the name
  // and description of every skill, and React can now paint the keystroke first.
  const deferredSearch = useDeferredValue(search);

  const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  const rows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let list = ranked.filter((r) => {
      if (hideInactive && !r.evaluation.canActivate) return false;
      if (q && !r.skill.name.toLowerCase().includes(q) && !r.skill.description.toLowerCase().includes(q))
        return false;
      if (effectFilters.length && !effectFilters.some((f) => r.skill.filterBuckets.includes(f))) return false;
      if (rarityFilters.length) {
        const rarity = r.skill.rarity === 'unique_upgraded' ? 'unique' : r.skill.rarity;
        if (!rarityFilters.includes(rarity)) return false;
      }
      if (hideInherited && r.skill.isInheritedUnique) return false;
      return true;
    });

    const dir = ascending ? 1 : -1;
    list = list.slice().sort((a, b) => {
      const pick = (r: RankedSkillView): number => {
        switch (sortKey) {
          case 'activated':
            return r.evaluation.activatedBashin;
          case 'efficiency':
            return r.evaluation.efficiency ?? -1;
          case 'probability':
            return r.evaluation.activationProbability;
          case 'cost':
            return r.skill.totalCost ?? Number.MAX_SAFE_INTEGER;
          default:
            return r.evaluation.expectedHorseLengths;
        }
      };
      return (pick(a) - pick(b)) * dir;
    });
    return list;
  }, [
    ranked,
    deferredSearch,
    sortKey,
    ascending,
    effectFilters,
    rarityFilters,
    hideInactive,
    hideInherited,
  ]);

  const shown = useMemo(() => rows.slice(0, visible), [rows, visible]);

  // Any change to the filtered set starts the window over at the top.
  useEffect(() => setVisible(PAGE_SIZE), [rows]);

  return (
    <Panel
      title="Skill ranking"
      subtitle={`${rows.length} of ${ranked.length} Global skills for the selected course and running style`}
    >
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="skill-search" className="text-xs font-medium text-[var(--color-ink-dim)]">
              Search
            </label>
            <input
              id="skill-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Skill name or effect"
              className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <div>
            <label htmlFor="skill-sort" className="text-xs font-medium text-[var(--color-ink-dim)]">
              Sort by
            </label>
            <select
              id="skill-sort"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SkillSortKey)}
              className="mt-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              {(Object.keys(SORT_LABELS) as SkillSortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <Toggle label={ascending ? 'Ascending' : 'Descending'} checked={!ascending} onChange={() => setAscending(!ascending)} />
          <Toggle label="Hide skills that cannot activate" checked={hideInactive} onChange={setHideInactive} />
          <Toggle
            label="Hide inherited uniques"
            checked={hideInherited}
            onChange={setHideInherited}
            title="Inherited uniques are the weaker 200 SP copies of a character's unique skill"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className="self-center text-xs text-[var(--color-ink-dim)]">Effect:</span>
          {EFFECT_FILTERS.map((f) => (
            <Toggle
              key={f.key}
              label={f.label}
              checked={effectFilters.includes(f.key)}
              onChange={() => toggle(effectFilters, setEffectFilters, f.key)}
            />
          ))}
          <span className="ml-3 self-center text-xs text-[var(--color-ink-dim)]">Rarity:</span>
          {RARITY_FILTERS.map((f) => (
            <Toggle
              key={f.key}
              label={f.label}
              checked={rarityFilters.includes(f.key)}
              onChange={() => toggle(rarityFilters, setRarityFilters, f.key)}
            />
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No skill matches these filters"
          hint="Clear the search box or turn off some filters."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-dim)]">
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">Skill</th>
                <th className="py-2 pr-2 font-medium">Rarity</th>
                <th className="py-2 pr-2 text-right font-medium">
                  <Tooltip label="Horse lengths the skill is worth in the races where it actually fires. Not weighted by how often that happens.">
                    <span className="cursor-help underline decoration-dotted">When activated</span>
                  </Tooltip>
                </th>
                <th className="py-2 pr-2 text-right font-medium">
                  <Tooltip label="Share of simulated races in which the skill's condition was met. Measured against a simulated field for opponent-dependent skills, estimated otherwise.">
                    <span className="cursor-help underline decoration-dotted">Rate</span>
                  </Tooltip>
                </th>
                <th className="py-2 pr-2 text-right font-medium">
                  <Tooltip label="When activated x activation rate. This is what the ranking sorts by.">
                    <span className="cursor-help underline decoration-dotted">Expected</span>
                  </Tooltip>
                </th>
                <th className="py-2 pr-2 text-right font-medium">
                  <Tooltip label="Worst activation position, before the activation probability is applied.">
                    <span className="cursor-help underline decoration-dotted">Min</span>
                  </Tooltip>
                </th>
                <th className="py-2 pr-2 text-right font-medium">
                  <Tooltip label="Best activation position, before the activation probability is applied.">
                    <span className="cursor-help underline decoration-dotted">Max</span>
                  </Tooltip>
                </th>
                <th className="py-2 pr-2 text-right font-medium">SP</th>
                <th className="py-2 pr-2 text-right font-medium">
                  <Tooltip
                    label={`Expected horse lengths x ${EFFICIENCY_SP_BASIS} / total skill point cost, including prerequisite skills.`}
                  >
                    <span className="cursor-help underline decoration-dotted">
                      Lengths / {EFFICIENCY_SP_BASIS} SP
                    </span>
                  </Tooltip>
                </th>
                <th className="py-2 pr-2 text-right font-medium">Waste</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const e = r.evaluation;
                const open = expanded === r.skill.id;
                return (
                  <tr key={r.skill.id} className="border-b border-[var(--color-line)]/60 align-top">
                    <td className="py-2 pr-2 text-xs text-[var(--color-ink-dim)]">{i + 1}</td>
                    <td className="py-2 pr-2">
                      <div className="flex items-start gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.skill.iconUrl}
                          alt=""
                          width={28}
                          height={28}
                          loading="lazy"
                          className="mt-0.5 h-7 w-7 shrink-0 rounded"
                        />
                        <div className="min-w-[12rem]">
                          <div className="font-medium">
                            <ExternalLink
                              href={r.skill.gameToraUrl}
                              title={
                                r.skill.gameToraUrlKind === 'character'
                                  ? 'GameTora has no per-skill page. Opens the page of the character that owns this unique skill.'
                                  : undefined
                              }
                            >
                              {r.skill.name}
                            </ExternalLink>
                          </div>
                          <div className="text-xs text-[var(--color-ink-dim)]">{r.skill.description}</div>
                          <div className="mt-1 text-[11px] text-[var(--color-ink-dim)] italic">
                            {r.skill.conditionText}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.skill.isInheritedUnique && (
                              <Badge tone="unique" title="Inheritable copy of a unique skill (200 SP)">
                                Inherited unique
                              </Badge>
                            )}
                            {r.skill.usesGlobalOverride && (
                              <Badge tone="accent" title="Global ships different values from the Japanese version">
                                Global values
                              </Badge>
                            )}
                            {r.skill.tagLabels.map((t) => (
                              <Badge key={t}>{t}</Badge>
                            ))}
                            <Badge tone={CONFIDENCE_TONE[e.valueConfidence] ?? 'neutral'}>
                              {CONFIDENCE_LABEL[e.valueConfidence] ?? e.valueConfidence}
                            </Badge>
                            {!e.canActivate && <Badge tone="bad">Cannot activate</Badge>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <Badge tone={RARITY_TONE[r.skill.rarity]}>{RARITY_LABEL[r.skill.rarity]}</Badge>
                    </td>
                    <td className="py-2 pr-2 text-right font-mono">{num(e.activatedBashin)}</td>
                    <td className="py-2 pr-2 text-right font-mono text-xs">
                      {num(e.activationProbability * 100, 0)}%
                    </td>
                    <td className="py-2 pr-2 text-right font-mono font-semibold text-[var(--color-accent)]">
                      {num(e.expectedBashin)}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono text-xs">{num(e.minHorseLengths)}</td>
                    <td className="py-2 pr-2 text-right font-mono text-xs">{num(e.maxHorseLengths)}</td>
                    <td className="py-2 pr-2 text-right font-mono text-xs">{r.skill.totalCost ?? '-'}</td>
                    <td className="py-2 pr-2 text-right font-mono text-xs">
                      {e.efficiency == null ? '-' : num(e.efficiency, 3)}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono text-xs">
                      {num(e.wastedDurationRatio * 100, 0)}%
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : r.skill.id)}
                        aria-expanded={open}
                        className="rounded-md border border-[var(--color-line)] px-2 py-1 text-xs whitespace-nowrap hover:border-[var(--color-accent)]"
                      >
                        {open ? 'Hide details' : 'Details'}
                      </button>
                      {open && (
                        <div className="mt-2 w-[min(90vw,52rem)]">
                          <DebugBreakdown item={r} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <div className="flex items-center justify-center gap-3 border-t border-[var(--color-line)]/60 py-3 text-xs">
              <span className="text-[var(--color-ink-dim)]">
                Showing {shown.length} of {rows.length}
              </span>
              <button
                type="button"
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                className="rounded-md border border-[var(--color-line)] px-2 py-1 hover:border-[var(--color-accent)]"
              >
                Show {Math.min(PAGE_SIZE, rows.length - shown.length)} more
              </button>
              <button
                type="button"
                onClick={() => setVisible(rows.length)}
                className="rounded-md border border-[var(--color-line)] px-2 py-1 hover:border-[var(--color-accent)]"
              >
                Show all {rows.length}
              </button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
