import type { TraceEntry } from '../../shared/types';

/** Entries sent to the renderer for one trace. */
export const MAX_TRACE_WINDOW = 200;
/** Entries from the start of a session that stay in the window, so the original task remains readable. */
export const MAX_HEAD_ENTRIES = 30;

export interface TraceWindowOptions {
  /** Id of the trace's agent, used for the marker entry id. */
  agentId: string;
  /** How many leading entries come from the retained start of the session. */
  headCount: number;
  /** True when records between the retained start and the tail were evicted before parsing. */
  middleEvicted: boolean;
  limit?: number;
}

/**
 * Keeps the start of a session and its latest entries within the window,
 * with one marker entry where the middle was left out.
 */
export function windowTraceEntries(entries: TraceEntry[], options: TraceWindowOptions): TraceEntry[] {
  const limit = options.limit ?? MAX_TRACE_WINDOW;
  if (!options.middleEvicted && entries.length <= limit) return entries;
  const head = Math.min(options.headCount, MAX_HEAD_ENTRIES, entries.length);
  const tailStart = Math.max(head, entries.length - (limit - head - 1));
  const hidden = tailStart - head;
  if (!options.middleEvicted && hidden === 0) return entries;
  const marker: TraceEntry = {
    id: `${options.agentId}:hidden-entries`,
    kind: 'event',
    // Evicted records were never parsed, so their entry count is unknown.
    text: options.middleEvicted
      ? '… earlier entries hidden to keep the trace responsive …'
      : `… ${hidden} earlier entries hidden to keep the trace responsive …`,
  };
  return [...entries.slice(0, head), marker, ...entries.slice(tailStart)];
}
