'use client';

import { useMemo, useState } from 'react';

import type { RankedCharacter } from '@/analysis/characterRanking';
import { RUNNING_STYLE_LABELS, type RunningStyle } from '@/simulation/config';
import { AnalysisDetails, ReliabilityChip, RequirementChip, num } from './skillRows';
import { Badge, EmptyState, ExternalLink, Panel, Toggle } from './ui';

const ROLE_LABEL: Record<string, string> = {
  unique: 'Unique',
  evolution: 'Evolution',
  innate: 'Innate',
  awakening: 'Awakening',
};

function AptitudeChip({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${ok ? 'border-emerald-400/50 text-emerald-300' : 'border-[var(--color-bad)]/50 text-[var(--color-bad)]'}`}>
      <span className="opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

export function CharacterTab({
  ranked,
  runningStyle,
  courseDistance,
  evolutionAvailable,
}: {
  ranked: RankedCharacter[];
  runningStyle: RunningStyle;
  courseDistance: number;
  evolutionAvailable: boolean;
}) {
  const [search, setSearch] = useState('');
  const [onlyCompatible, setOnlyCompatible] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ranked.filter((r) => {
      if (q && !`${r.character.name} ${r.character.title}`.toLowerCase().includes(q)) return false;
      if (onlyCompatible && !(r.aptitude.surfaceOk && r.aptitude.distanceOk && r.aptitude.styleOk)) return false;
      return true;
    });
  }, [ranked, search, onlyCompatible]);

  return (
    <Panel
      title="Character ranking"
      subtitle={`Innate unique skill value on this course for a ${RUNNING_STYLE_LABELS[runningStyle]} - not a PvP tier list`}
    >
      <div className="mb-3 rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-3 py-2 text-xs text-[var(--color-warn)]">
        This ranks only the value of a character&apos;s own unique skill (and evolution skills once they exist on Global). It ignores stats, support cards, inherited factors and everything that happens between runners in a real race.
        {!evolutionAvailable && ' No evolution skill has been released on Global yet, so the score is the unique skill only.'}
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Character or costume name"
            aria-label="Search characters"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <Toggle label="Only aptitude-compatible characters" checked={onlyCompatible} onChange={setOnlyCompatible} title="Requires B or better surface, distance and running-style aptitude" />
        <span className="text-xs text-[var(--color-ink-dim)]">{rows.length} characters</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No character matches" />
      ) : (
        <ol className="space-y-1">
          {rows.map((r, i) => {
            const open = expanded === r.character.cardId;
            const unique = r.contributions.find((c) => c.countedInScore) ?? r.contributions[0];
            return (
              <li key={r.character.cardId} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)]">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : r.character.cardId)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-panel-2)]/60"
                >
                  <span className="w-7 text-right text-xs text-[var(--color-ink-dim)] tabular-nums">{i + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.character.imageUrl} alt="" width={36} height={36} className="h-9 w-9 rounded" loading="lazy" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      <ExternalLink href={r.character.gameToraUrl}>{r.character.name}</ExternalLink>
                      <span className="text-[var(--color-ink-dim)]"> {r.character.title}</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      <AptitudeChip label="Surface" value={r.aptitude.surface} ok={r.aptitude.surfaceOk} />
                      <AptitudeChip label="Distance" value={r.aptitude.distance} ok={r.aptitude.distanceOk} />
                      <AptitudeChip label="Style" value={r.aptitude.style} ok={r.aptitude.styleOk} />
                      {unique?.analysis && <ReliabilityChip reliability={unique.analysis.reliability} />}
                      {unique?.analysis && <RequirementChip requirements={unique.analysis.requirements} />}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-semibold tabular-nums">{num(r.score)}</span>
                    <span className="block text-[10px] text-[var(--color-ink-dim)]">lengths</span>
                  </span>
                </button>
                {open && (
                  <div className="space-y-2 border-t border-[var(--color-line)] px-3 py-2 text-xs">
                    {r.contributions.map((c) => (
                      <div key={c.skill.id} className="rounded border border-[var(--color-line)] p-2">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <Badge tone={c.countedInScore ? 'accent' : 'neutral'}>{ROLE_LABEL[c.role]}</Badge>
                          <span className="font-medium">{c.skill.name}</span>
                          {c.analysis && <span className="tabular-nums text-[var(--color-ink-dim)]">{num(c.analysis.gain.mean)} lengths</span>}
                          {!c.countedInScore && <span className="text-[var(--color-ink-dim)]">not counted</span>}
                        </div>
                        {c.analysis ? <AnalysisDetails row={{ skill: c.skill, analysis: c.analysis }} courseDistance={courseDistance} /> : <p className="text-[var(--color-ink-dim)]">Not analysed for this course.</p>}
                      </div>
                    ))}
                    {r.notes.map((n) => (
                      <p key={n} className="text-[var(--color-ink-dim)]">{n}</p>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
