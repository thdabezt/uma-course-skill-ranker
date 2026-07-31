'use client';

import { useMemo, useState } from 'react';

import type { RankedCharacter } from '@/ranking/characterRanking';
import { RUNNING_STYLE_LABELS, type RunningStyle } from '@/simulation/config';
import { Badge, EmptyState, ExternalLink, Panel, Toggle, Tooltip } from './ui';

const ROLE_LABEL: Record<string, string> = {
  unique: 'Unique',
  evolution: 'Evolution',
  innate: 'Innate',
  awakening: 'Awakening',
};

function AptitudeChip({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
        ok ? 'border-emerald-400/50 text-emerald-300' : 'border-[var(--color-bad)]/50 text-[var(--color-bad)]'
      }`}
    >
      <span className="opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

export function CharacterRanking({
  ranked,
  runningStyle,
  evolutionAvailable,
}: {
  ranked: RankedCharacter[];
  runningStyle: RunningStyle;
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
      subtitle={`Built-in skill value on this course for a ${RUNNING_STYLE_LABELS[runningStyle]} - not a PvP tier list`}
    >
      <div className="mb-3 rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-3 py-2 text-xs text-[var(--color-warn)]">
        This ranks only the value of a character&apos;s own skills on the selected course. It ignores stats,
        support cards, inherited factors and everything that happens between runners in a real race.
        {!evolutionAvailable && ' No evolution skill has been released on Global yet, so the score is the unique skill only.'}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="char-search" className="text-xs font-medium text-[var(--color-ink-dim)]">
            Search
          </label>
          <input
            id="char-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Character or costume name"
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <Toggle
          label="Only aptitude-compatible characters"
          checked={onlyCompatible}
          onChange={setOnlyCompatible}
          title="Requires B or better surface, distance and running-style aptitude"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No character matches these filters" hint="Clear the search or the compatibility filter." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-dim)]">
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">Character</th>
                <th className="py-2 pr-2 font-medium">Aptitude</th>
                <th className="py-2 pr-2 text-right font-medium">
                  <Tooltip label="Unique skill + up to two evolution skills, each measured as expected horse lengths on this course.">
                    <span className="cursor-help underline decoration-dotted">Score</span>
                  </Tooltip>
                </th>
                <th className="py-2 pr-2 font-medium">Counted skills</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const open = expanded === r.character.cardId;
                const counted = r.contributions.filter((c) => c.countedInScore);
                return (
                  <tr key={r.character.cardId} className="border-b border-[var(--color-line)]/60 align-top">
                    <td className="py-2 pr-2 text-xs text-[var(--color-ink-dim)]">{i + 1}</td>
                    <td className="py-2 pr-2">
                      <div className="flex items-start gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.character.imageUrl}
                          alt=""
                          width={40}
                          height={40}
                          loading="lazy"
                          className="h-10 w-10 shrink-0 rounded bg-[var(--color-panel-2)] object-cover"
                        />
                        <div>
                          <div className="font-medium">
                            <ExternalLink href={r.character.gameToraUrl}>
                              {r.character.name}
                            </ExternalLink>
                          </div>
                          <div className="text-xs text-[var(--color-ink-dim)]">{r.character.title}</div>
                          <div className="mt-0.5 text-[10px] text-[var(--color-ink-dim)]">
                            Global release {r.character.globalReleaseDate}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-col gap-1">
                        <AptitudeChip label="Surface" value={r.aptitude.surface} ok={r.aptitude.surfaceOk} />
                        <AptitudeChip label="Distance" value={r.aptitude.distance} ok={r.aptitude.distanceOk} />
                        <AptitudeChip label="Style" value={r.aptitude.style} ok={r.aptitude.styleOk} />
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right font-mono font-semibold text-[var(--color-accent)]">
                      {r.score.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2">
                      <ul className="space-y-0.5 text-xs">
                        {counted.map((c) => (
                          <li key={c.skill.id} className="flex items-center gap-1.5">
                            <Badge tone={c.role === 'unique' ? 'unique' : 'evolution'}>{ROLE_LABEL[c.role]}</Badge>
                            <ExternalLink href={c.skill.gameToraUrl}>{c.skill.name}</ExternalLink>
                            <span className="font-mono text-[var(--color-accent)]">
                              +{c.expectedHorseLengths.toFixed(2)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : r.character.cardId)}
                        aria-expanded={open}
                        className="rounded-md border border-[var(--color-line)] px-2 py-1 text-xs whitespace-nowrap hover:border-[var(--color-accent)]"
                      >
                        {open ? 'Hide details' : 'Details'}
                      </button>
                      {open && (
                        <div className="mt-2 w-[min(90vw,44rem)] space-y-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-3 text-xs">
                          <div>
                            <h4 className="mb-1 font-semibold">All built-in skills on this course</h4>
                            <table className="w-full text-[11px]">
                              <thead className="text-[var(--color-ink-dim)]">
                                <tr className="text-left">
                                  <th className="py-1 pr-2">Role</th>
                                  <th className="py-1 pr-2">Skill</th>
                                  <th className="py-1 pr-2 text-right">Expected</th>
                                  <th className="py-1 pr-2 text-right">Activation</th>
                                  <th className="py-1 pr-2">Counted</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.contributions.map((c) => (
                                  <tr key={`${c.role}-${c.skill.id}`} className="border-t border-[var(--color-line)]">
                                    <td className="py-1 pr-2">{ROLE_LABEL[c.role]}</td>
                                    <td className="py-1 pr-2">
                                      <ExternalLink href={c.skill.gameToraUrl}>{c.skill.name}</ExternalLink>
                                    </td>
                                    <td className="py-1 pr-2 text-right font-mono">
                                      {c.expectedHorseLengths.toFixed(3)}
                                    </td>
                                    <td className="py-1 pr-2 text-right font-mono">
                                      {(c.evaluation.activationProbability * 100).toFixed(0)}%
                                    </td>
                                    <td className="py-1 pr-2">{c.countedInScore ? 'yes' : 'no'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {r.inactiveSkills.length > 0 && (
                            <div>
                              <h4 className="mb-1 font-semibold">Skills that cannot activate here</h4>
                              <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-ink-dim)]">
                                {r.inactiveSkills.map((s) => (
                                  <li key={s.skill.id}>
                                    <ExternalLink href={s.skill.gameToraUrl} className="text-[var(--color-ink)]">
                                      {s.skill.name}
                                    </ExternalLink>{' '}
                                    - {s.reason}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {r.notes.length > 0 && (
                            <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-ink-dim)]">
                              {r.notes.map((n, ni) => (
                                <li key={ni}>{n}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
