import assert from 'node:assert/strict';
import test from 'node:test';
import { groupTraceEntries, type TraceEntryDetails } from '../src/renderer/traceConversation';
import { blockKey, findMatches, findOccurrences, findRegions, toolKey } from '../src/renderer/traceFind';

let sequence = 0;

function entry(kind: TraceEntryDetails['kind'], text: string, extra: Partial<TraceEntryDetails> = {}): TraceEntryDetails {
  sequence += 1;
  return { id: `find-${sequence}`, kind, text, timestamp: sequence, ...extra };
}

test('finds every occurrence, case-insensitively by default', () => {
  assert.deepEqual(findOccurrences('Alpha alpha ALPHA', 'alpha'), [0, 6, 12]);
  assert.deepEqual(findOccurrences('Alpha alpha ALPHA', 'alpha', true), [6]);
  assert.deepEqual(findOccurrences('aaaa', 'aa'), [0, 2]);
  assert.deepEqual(findOccurrences('text', ''), []);
});

test('regions cover visible text, thinking, tool input and result, and unmatched results', () => {
  const groups = groupTraceEntries([
    entry('user', 'Find the needle'),
    entry('thinking', 'Thinking about the needle'),
    entry('assistant', 'Looking'),
    entry('tool-call', 'Bash: {"command":"grep needle"}', { callId: 'call-1', toolName: 'Bash' }),
    entry('tool-result', '{"stdout":"needle\\nhaystack"}', { callId: 'call-1' }),
    entry('usage', 'Usage: 1 input · 1 output'),
    entry('tool-result', 'orphan needle', { callId: 'missing' }),
  ]);
  const [user, assistant, orphan] = groups;
  const thinkingKey = blockKey(assistant.id, 'thinking', 0);
  const toolsKey = blockKey(assistant.id, 'tools', 2);
  const rowKey = toolKey(toolsKey, 0);
  const orphanKey = blockKey(orphan.id, 'tool-result', 0);

  assert.deepEqual(findRegions(groups).map(({ key, text, reveal }) => ({ key, text, reveal })), [
    { key: blockKey(user.id, 'text', 0), text: 'Find the needle', reveal: { open: [], expand: [] } },
    { key: thinkingKey, text: 'Thinking about the needle', reveal: { open: [thinkingKey], expand: [] } },
    { key: blockKey(assistant.id, 'text', 1), text: 'Looking', reveal: { open: [], expand: [] } },
    // Payloads are searched as displayed: decorated, with real line breaks instead of JSON escapes.
    { key: `${rowKey}:input`, text: 'grep needle', reveal: { open: [rowKey], expand: [toolsKey] } },
    { key: `${rowKey}:result`, text: 'stdout:\nneedle\nhaystack', reveal: { open: [rowKey], expand: [toolsKey] } },
    // Usage inside an assistant card is only summarized in the header, so it is not a region.
    { key: orphanKey, text: 'orphan needle', reveal: { open: [orphanKey], expand: [] } },
  ]);
});

test('matches follow display order and carry the region occurrence', () => {
  const groups = groupTraceEntries([
    entry('user', 'needle and needle'),
    entry('assistant', 'one needle'),
  ]);
  const matches = findMatches(groups, 'NEEDLE');
  assert.deepEqual(matches.map(({ region, occurrence }) => [region, occurrence]), [
    [blockKey(groups[0].id, 'text', 0), 0],
    [blockKey(groups[0].id, 'text', 0), 1],
    [blockKey(groups[1].id, 'text', 0), 0],
  ]);
  assert.equal(findMatches(groups, 'NEEDLE', { caseSensitive: true }).length, 0);
  assert.equal(findMatches(groups, '   ').length, 0);
});

test('context entries are searchable and revealed like other collapsed blocks', () => {
  const groups = groupTraceEntries([
    entry('context', '<environment_context>\n  <cwd>/tmp/needle</cwd>\n</environment_context>'),
    entry('user', 'Fix it'),
  ]);
  const key = blockKey(groups[0].id, 'context', 0);
  assert.deepEqual(findMatches(groups, 'needle').map(({ region, reveal }) => ({ region, reveal })), [
    { region: key, reveal: { open: [key], expand: [] } },
  ]);
});
