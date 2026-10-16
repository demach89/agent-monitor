import assert from 'node:assert/strict';
import test from 'node:test';
import type { TraceEntry } from '../src/shared/types';
import { sliceTraceRange } from '../src/shared/traceRange';
import { emptyTraceLoad, firstRequest, mergePage, nextRequest, remainingRequests } from '../src/renderer/traceLoad';

const all: TraceEntry[] = Array.from({ length: 10 }, (_, index) => ({ id: `e${index}`, kind: 'assistant', text: String(index) }));
const page = (request: Parameters<typeof sliceTraceRange>[1]) => sliceTraceRange(all, request);
const texts = (state: { entries: TraceEntry[] }) => state.entries.map((entry) => entry.text).join('');

test('the first page comes from the edge the order reads from', () => {
  assert.deepEqual(emptyTraceLoad, { entries: [], start: 0, end: 0, total: 0 });
  assert.deepEqual(firstRequest('oldest'), { start: 0, limit: 200 });
  assert.deepEqual(firstRequest('newest'), { limit: 200 });
});

test('the next page continues in reading direction until that edge', () => {
  const oldest = mergePage(emptyTraceLoad, page({ start: 0, limit: 4 }));
  assert.deepEqual(nextRequest(oldest, 'oldest'), { start: 4, limit: 200 });
  const newest = mergePage(emptyTraceLoad, page({ limit: 4 }));
  assert.deepEqual([newest.start, newest.end, texts(newest)], [6, 10, '6789']);
  assert.deepEqual(nextRequest(newest, 'newest'), { end: 6, limit: 200 });
  const full = mergePage(emptyTraceLoad, page({ start: 0, limit: 10 }));
  assert.equal(nextRequest(full, 'oldest'), undefined);
  assert.equal(nextRequest(full, 'newest'), undefined);
});

test('pages merge on either side without duplicates', () => {
  let state = mergePage(emptyTraceLoad, page({ start: 3, limit: 3 }));
  state = mergePage(state, page({ start: 6, limit: 2 }));
  state = mergePage(state, page({ end: 3, limit: 2 }));
  assert.deepEqual([state.start, state.end, texts(state)], [1, 8, '1234567']);
  state = mergePage(state, page({ start: 2, limit: 3 }));
  assert.deepEqual([state.start, state.end, texts(state)], [1, 8, '1234567']);
  state = mergePage(state, page({ start: 6, limit: 4 }));
  assert.deepEqual([state.start, state.end, texts(state), state.total], [1, 10, '123456789', 10]);
});

test('pages that do not touch the loaded range are ignored', () => {
  const state = mergePage(emptyTraceLoad, page({ start: 0, limit: 2 }));
  assert.equal(mergePage(state, page({ start: 5, limit: 2 })), state);
});

test('remaining requests reach an edge, or both for whole-session search', () => {
  const state = mergePage(emptyTraceLoad, page({ start: 3, limit: 3 }));
  assert.deepEqual(remainingRequests(state, 'end'), [{ start: 6, limit: 4 }]);
  assert.deepEqual(remainingRequests(state, 'start'), [{ end: 3, limit: 3 }]);
  assert.deepEqual(remainingRequests(state, 'both'), [{ end: 3, limit: 3 }, { start: 6, limit: 4 }]);
  const full = mergePage(emptyTraceLoad, page({ start: 0, limit: 10 }));
  assert.deepEqual(remainingRequests(full, 'both'), []);
});
