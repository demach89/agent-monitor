import type { TraceEntry, TracePage, TraceRangeRequest } from '../shared/types';
import { TRACE_PAGE_SIZE } from '../shared/traceRange';

/** One contiguous, growing range of a trace loaded into a tab: entries `[start, end)` of `total`. */
export interface TraceLoadState {
  entries: TraceEntry[];
  start: number;
  end: number;
  total: number;
}

export type TraceLoadOrder = 'oldest' | 'newest';

export const emptyTraceLoad: TraceLoadState = { entries: [], start: 0, end: 0, total: 0 };

/** The first page: the start of the session for oldest-first reading, its end for newest-first. */
export function firstRequest(order: TraceLoadOrder): TraceRangeRequest {
  return order === 'oldest' ? { start: 0, limit: TRACE_PAGE_SIZE } : { limit: TRACE_PAGE_SIZE };
}

/** Next page in reading direction, or undefined when that edge is loaded. */
export function nextRequest(state: TraceLoadState, order: TraceLoadOrder): TraceRangeRequest | undefined {
  if (order === 'oldest') return state.end < state.total ? { start: state.end, limit: TRACE_PAGE_SIZE } : undefined;
  return state.start > 0 ? { end: state.start, limit: TRACE_PAGE_SIZE } : undefined;
}

/** Everything left up to an edge, or on both sides for searching the whole session. */
export function remainingRequests(state: TraceLoadState, edge: 'start' | 'end' | 'both'): TraceRangeRequest[] {
  const requests: TraceRangeRequest[] = [];
  if (edge !== 'end' && state.start > 0) requests.push({ end: state.start, limit: state.start });
  if (edge !== 'start' && state.end < state.total) requests.push({ start: state.end, limit: state.total - state.end });
  return requests;
}

/** Adds a page adjacent to or overlapping the loaded range. Pages that leave a gap are ignored. */
export function mergePage(state: TraceLoadState, page: TracePage): TraceLoadState {
  const pageEnd = page.start + page.entries.length;
  if (!state.entries.length && state.start === state.end) {
    return { entries: page.entries, start: page.start, end: pageEnd, total: page.total };
  }
  if (pageEnd < state.start || page.start > state.end) return state;
  const before = page.entries.slice(0, Math.max(0, state.start - page.start));
  const after = page.entries.slice(Math.max(0, state.end - page.start));
  return {
    entries: [...before, ...state.entries, ...after],
    start: Math.min(state.start, page.start),
    end: Math.max(state.end, pageEnd),
    total: page.total,
  };
}
