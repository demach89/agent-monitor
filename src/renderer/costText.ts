import type { Agent } from '../shared/types';
import { estimateAgentCost, estimateModelCosts, type ModelCostRow } from '../shared/pricing';

export function usd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'Unknown';
  if (value !== 0 && Math.abs(value) < 0.0001) return '<$0.0001';
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

/** Cents are enough for headers and lists; the breakdown keeps full precision. */
export function usdShort(value: number) {
  if (Math.abs(value) < 1) return usd(value);
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A partial estimate keeps its known subtotal, marked with `+`: the full cost is at least that much. */
export function costLabel(knownUsd: number, complete: boolean, format: (value: number) => string): string {
  if (complete) return format(knownUsd);
  return knownUsd > 0 ? `${format(knownUsd)}+` : 'Unknown';
}

/** Names the models whose tokens have no price, most unpriced tokens first; empty when everything is priced. */
export function unpricedNote(rows: readonly ModelCostRow[]): string {
  const unpriced = rows.filter((row) => row.unpricedTokens > 0).sort((a, b) => b.unpricedTokens - a.unpricedTokens);
  if (!unpriced.length) return '';
  return [
    'Not priced:',
    ...unpriced.map((row) => `• ${row.model}: ${row.unpricedTokens.toLocaleString()} tokens${row.notes.length ? ` (${row.notes.join(' ')})` : ''}`),
  ].join('\n');
}

export interface RunCost { knownUsd: number; unpricedTokens: number; complete: boolean; unpriced: string }

/** The run total shown in the token breakdown and the run list. */
export function runCost(agents: readonly Agent[]): RunCost {
  const total = agents.map(estimateAgentCost).reduce((sum, cost) => ({
    knownUsd: sum.knownUsd + cost.knownUsd,
    unpricedTokens: sum.unpricedTokens + cost.unpricedTokens,
    complete: sum.complete && cost.complete && cost.usd !== null,
  }), { knownUsd: 0, unpricedTokens: 0, complete: agents.length > 0 });
  return { ...total, unpriced: unpricedNote(estimateModelCosts(agents)) };
}
