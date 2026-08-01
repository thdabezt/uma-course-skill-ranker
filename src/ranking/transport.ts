import type { ActivationAnalysis, ClauseAnalysis } from '@/skills/activation';
import type { EventTerm } from '@/skills/activationModel';
import type { GroupEvaluation, SkillEvaluation } from './skillEvaluation';

/**
 * Display-safe evaluation types: everything an evaluation carries except the parts
 * that only mean something inside a running simulation.
 *
 * The one such part is `EventTerm.predicate`, a closure built in
 * `buildEventPredicate` (src/skills/activationModel.ts) and carried out through
 * `ActivationAnalysis` -> `GroupEvaluation.activation` -> `SkillEvaluation.groups`.
 * It is called during simulation and never read by the UI, which touches only
 * `.possible`, `.isEstimate`, `.windows`, `.randomWithinWindow` and `.probability`.
 *
 * Being predicate-free is what makes a result structured-cloneable, and therefore
 * what lets the ranking run in a worker: `structuredClone` on a raw result throws
 * `DataCloneError`, and 242 of the 653 Global skills carry a predicate.
 *
 * A full `SkillEvaluation` is structurally assignable to `TransportSkillEvaluation`
 * (an extra property is fine), so the single-threaded fallback path needs no
 * conversion - only the worker path calls `stripPredicates`.
 */

export type TransportEventTerm = Omit<EventTerm, 'predicate'>;

export type TransportClauseAnalysis = Omit<ClauseAnalysis, 'eventTerms'> & {
  eventTerms: TransportEventTerm[];
};

export type TransportActivationAnalysis = Omit<
  ActivationAnalysis,
  'eventTerms' | 'preconditionEventTerms' | 'clauses'
> & {
  eventTerms: TransportEventTerm[];
  preconditionEventTerms: TransportEventTerm[];
  clauses: TransportClauseAnalysis[];
};

export type TransportGroupEvaluation = Omit<GroupEvaluation, 'activation'> & {
  activation: TransportActivationAnalysis;
};

export type TransportSkillEvaluation = Omit<SkillEvaluation, 'groups'> & {
  groups: TransportGroupEvaluation[];
};

const stripTerm = ({ name, model, description }: EventTerm): TransportEventTerm => ({
  name,
  model,
  description,
});

function stripActivation(a: ActivationAnalysis): TransportActivationAnalysis {
  return {
    ...a,
    eventTerms: a.eventTerms.map(stripTerm),
    preconditionEventTerms: a.preconditionEventTerms.map(stripTerm),
    clauses: a.clauses.map((c) => ({ ...c, eventTerms: c.eventTerms.map(stripTerm) })),
  };
}

/** Makes one evaluation structured-cloneable. Shallow copies; the input is untouched. */
export function stripPredicates(e: SkillEvaluation): TransportSkillEvaluation {
  return {
    ...e,
    groups: e.groups.map((g) => ({ ...g, activation: stripActivation(g.activation) })),
  };
}
