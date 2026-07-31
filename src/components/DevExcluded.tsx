'use client';

import { useEffect, useState } from 'react';

import { loadExcludedContent, type ExcludedContent } from '@/data';
import { ErrorState, Panel, Spinner } from './ui';

/**
 * Developer-only view of content that exists in the upstream data but is not
 * released on the Global server. It is loaded lazily and is never merged into the
 * rankings.
 */
export function DevExcluded() {
  const [data, setData] = useState<ExcludedContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'skills' | 'characters' | 'courses'>('skills');

  useEffect(() => {
    let cancelled = false;
    loadExcludedContent()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorState title="Could not load the excluded-content file" detail={error} />;
  if (!data) return <Spinner label="Loading Japan-only content..." />;

  const tabs = [
    { key: 'skills' as const, label: `Skills (${data.skills.length})` },
    { key: 'characters' as const, label: `Characters (${data.characters.length})` },
    { key: 'courses' as const, label: `Racecourses (${data.courses.length})` },
  ];

  return (
    <Panel
      title="Developer view: content excluded from Global"
      subtitle="Never included in the rankings above. Shown only to verify the Global filter."
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-3 py-1 text-xs ${
              tab === t.key
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-[var(--color-line)] text-[var(--color-ink-dim)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-h-96 overflow-auto rounded-lg border border-[var(--color-line)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--color-panel-2)] text-left text-[var(--color-ink-dim)]">
            <tr>
              <th className="px-2 py-1.5">Id</th>
              <th className="px-2 py-1.5">Name</th>
              <th className="px-2 py-1.5">Reason</th>
            </tr>
          </thead>
          <tbody>
            {tab === 'skills' &&
              data.skills.map((s) => (
                <tr key={s.id} className="border-t border-[var(--color-line)]">
                  <td className="px-2 py-1 font-mono">{s.id}</td>
                  <td className="px-2 py-1">
                    {s.name} <span className="text-[var(--color-ink-dim)]">({s.rarity})</span>
                  </td>
                  <td className="px-2 py-1 text-[var(--color-ink-dim)]">{s.reason}</td>
                </tr>
              ))}
            {tab === 'characters' &&
              data.characters.map((c) => (
                <tr key={c.cardId} className="border-t border-[var(--color-line)]">
                  <td className="px-2 py-1 font-mono">{c.cardId}</td>
                  <td className="px-2 py-1">{c.name}</td>
                  <td className="px-2 py-1 text-[var(--color-ink-dim)]">{c.reason}</td>
                </tr>
              ))}
            {tab === 'courses' &&
              data.courses.map((c) => (
                <tr key={c.id} className="border-t border-[var(--color-line)]">
                  <td className="px-2 py-1 font-mono">{c.id}</td>
                  <td className="px-2 py-1">{c.name}</td>
                  <td className="px-2 py-1 text-[var(--color-ink-dim)]">{c.reason}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
