/**
 * Parser for GameTora's skill-condition expression grammar.
 *
 *   expression := clause ('@' clause)*      -- '@' is OR
 *   clause     := term ('&' term)*          -- '&' is AND
 *   term       := name op number
 *   op         := '==' | '!=' | '>=' | '<=' | '>' | '<'
 *
 * Example:
 *   "distance_rate>=50&order==1@distance_rate>=50&order==2&is_overtake==1"
 *   = (progress >= 50 % AND 1st place) OR (progress >= 50 % AND 2nd place AND overtaking)
 */

export type ConditionOperator = '==' | '!=' | '>=' | '<=' | '>' | '<';

export interface ConditionTerm {
  name: string;
  operator: ConditionOperator;
  value: number;
  raw: string;
}

/** AND-joined terms. */
export interface ConditionClause {
  terms: ConditionTerm[];
  raw: string;
}

/** OR-joined clauses. */
export type ConditionExpression = ConditionClause[];

const TERM_RE = /^([a-z_0-9]+)(==|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/;

export function parseConditionTerm(raw: string): ConditionTerm | null {
  const m = raw.trim().match(TERM_RE);
  if (!m) return null;
  return {
    name: m[1],
    operator: m[2] as ConditionOperator,
    value: Number(m[3]),
    raw: raw.trim(),
  };
}

export function parseCondition(expression: string | null | undefined): ConditionExpression {
  if (!expression) return [];
  return expression
    .split('@')
    .map((clauseRaw) => {
      const terms = clauseRaw
        .split('&')
        .map(parseConditionTerm)
        .filter((t): t is ConditionTerm => t !== null);
      return { terms, raw: clauseRaw.trim() };
    })
    .filter((c) => c.terms.length > 0);
}

export function compare(actual: number, operator: ConditionOperator, expected: number): boolean {
  switch (operator) {
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    default:
      return false;
  }
}

/** Every distinct condition name used anywhere in an expression. */
export function conditionNames(expression: string | null | undefined): string[] {
  return [...new Set(parseCondition(expression).flatMap((c) => c.terms.map((t) => t.name)))];
}
