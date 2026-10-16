import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contextLabel,
  filterConversationGroups,
  getToolInput,
  groupTraceEntries,
  type TraceEntryDetails,
} from '../src/renderer/traceConversation';

let sequence = 0;

function entry(kind: TraceEntryDetails['kind'], text: string, extra: Partial<TraceEntryDetails> = {}): TraceEntryDetails {
  sequence += 1;
  return { id: `trace-${sequence}`, kind, text, timestamp: sequence, ...extra };
}

test('pairs interleaved tool results by call id and keeps assistant follow-up separate', () => {
  const firstCall = entry('tool-call', 'search: first', { callId: 'call-a', toolName: 'search' });
  const secondCall = entry('tool-call', 'exec: second', { callId: 'call-b', toolName: 'exec' });
  const secondResult = entry('tool-result', 'result-b', { callId: 'call-b' });
  const firstResult = entry('tool-result', 'result-a', { callId: 'call-a' });
  const groups = groupTraceEntries([
    entry('assistant', 'Before tools'),
    firstCall,
    secondCall,
    secondResult,
    firstResult,
    entry('assistant', 'After tools'),
  ]);

  assert.equal(groups.length, 2);
  const tools = groups[0].blocks.find((block) => block.type === 'tools');
  assert(tools && tools.type === 'tools');
  assert.equal(tools.tools.length, 2);
  assert.equal(tools.tools[0].call.callId, 'call-a');
  assert.equal(tools.tools[0].result?.text, 'result-a');
  assert.equal(tools.tools[1].call.callId, 'call-b');
  assert.equal(tools.tools[1].result?.text, 'result-b');
  assert.equal(groups[1].blocks[0].type, 'text');
});

test('retains orphaned results and calls without ids without proximity pairing', () => {
  const orphan = entry('tool-result', 'orphan output', { callId: 'missing-call' });
  const noIdCall = entry('tool-call', 'shell: ls', { toolName: 'shell' });
  const noIdResult = entry('tool-result', 'nearby but unrelated');
  const groups = groupTraceEntries([orphan, noIdCall, noIdResult]);

  const orphanBlock = groups[0].blocks.find((block) => block.type === 'tool-result');
  assert(orphanBlock && orphanBlock.type === 'tool-result');
  assert.equal(orphanBlock.entry.text, 'orphan output');
  const toolGroups = groups.filter((group) => group.blocks.some((block) => block.type === 'tools'));
  assert.equal(toolGroups.length, 1);
  const tools = toolGroups[0].blocks.find((block) => block.type === 'tools');
  assert(tools && tools.type === 'tools');
  assert.equal(tools.tools[0].result, undefined);
  assert(groups.some((group) => group.blocks.some((block) => block.type === 'tool-result' && block.entry.text === 'nearby but unrelated')));
});

test('splits on users, model/turn changes, and keeps usage between tool calls in one section', () => {
  const groups = groupTraceEntries([
    entry('user', 'Inspect this'),
    entry('thinking', 'Reasoning', { model: 'model-a', turnId: 'turn-a' }),
    entry('tool-call', 'search: files', { callId: 'call-a', toolName: 'search', model: 'model-a', turnId: 'turn-a' }),
    entry('usage', 'Usage: 10 input', { model: 'model-a', turnId: 'turn-a' }),
    entry('tool-call', 'exec: tests', { callId: 'call-b', toolName: 'exec', model: 'model-a', turnId: 'turn-a' }),
    entry('assistant', 'A new model answered', { model: 'model-b', turnId: 'turn-b' }),
  ]);

  assert.equal(groups.length, 3);
  const tools = groups[1].blocks.filter((block) => block.type === 'tools');
  assert.equal(tools.length, 1);
  assert(tools[0].type === 'tools');
  assert.equal(tools[0].tools.length, 2);
  assert.equal(groups[2].model, 'model-b');
  assert.equal(groups[2].turnId, 'turn-b');
});

test('search and kind filters retain the paired result context', () => {
  const groups = groupTraceEntries([
    entry('assistant', 'Preparing'),
    entry('tool-call', 'exec: test', { callId: 'call-search', toolName: 'exec' }),
    entry('tool-result', 'distinctive result text', { callId: 'call-search' }),
  ]);
  const matches = filterConversationGroups(groups, 'distinctive result');
  assert.equal(matches.length, 1);
  assert.equal(filterConversationGroups(groups, '', 'tool-result').length, 1);
  const tools = matches[0].blocks.find((block) => block.type === 'tools');
  assert(tools && tools.type === 'tools');
  assert.equal(tools.tools[0].call.toolName, 'exec');
  assert.equal(getToolInput(tools.tools[0].call), 'test');
});

test('error filter keeps paired and orphaned tool errors visible', () => {
  const groups = groupTraceEntries([
    entry('tool-call', 'exec: failing', { callId: 'call-error', toolName: 'exec' }),
    entry('error', 'paired failure', { callId: 'call-error' }),
    entry('error', 'orphan failure', { callId: 'evicted-call' }),
  ]);
  const errors = filterConversationGroups(groups, '', 'error');
  assert.equal(errors.length, 2);
  assert(errors.some((group) => group.blocks.some((block) => block.type === 'tool-result' && block.entry.text === 'orphan failure')));
  assert(errors.some((group) => group.blocks.some((block) => block.type === 'tools' && block.tools[0].result?.text === 'paired failure')));
});

test('cumulative thinking updates collapse without merging distinct steps or crossing tools and turns', () => {
  const groups = groupTraceEntries([
    entry('thinking','Plan'), entry('thinking','Plan\nRead'), entry('thinking','Plan\nRead'),
    entry('thinking','A different step'), entry('tool-call','read: {}',{callId:'x'}),
    entry('thinking','A different step continued'), entry('thinking','A different step continued',{turnId:'next'}),
  ]);
  const thinking=groups.flatMap(g=>g.blocks).filter(b=>b.type==='thinking');
  assert.equal(thinking.length,3);
  assert.equal(thinking[0].type==='thinking' && thinking[0].entry.text,'Plan\nRead');
  assert.equal(thinking[0].type==='thinking' && thinking[0].updates,3);
  const turns=groupTraceEntries([entry('thinking','Same',{turnId:'a'}),entry('thinking','Same longer',{turnId:'b'})]);
  assert.equal(turns.length,2);
});

test('reports the latest usage and time span for a conversation card', async () => {
  const { conversationDuration, conversationUsage } = await import('../src/renderer/traceConversation');
  const [group] = groupTraceEntries([
    entry('assistant', 'Working', { timestamp: 1_000 }),
    entry('usage', 'Usage: 100 input · 5 output', { timestamp: 1_500 }),
    entry('tool-call', 'exec: ls', { callId: 'call-span', toolName: 'exec', timestamp: 2_000 }),
    entry('usage', 'Usage: 162332 input · 39 output', { timestamp: 2_500 }),
    entry('tool-result', 'done', { callId: 'call-span', timestamp: 27_944 }),
  ]);
  assert.deepEqual(conversationUsage(group), { input: 162332, output: 39 });
  assert.equal(conversationDuration(group), 26_944);
  assert.equal(conversationDuration(groupTraceEntries([entry('assistant', 'Alone')])[0]), undefined);
});

test('consecutive context entries share one context card and are labeled by their wrapper tag', () => {
  const groups = groupTraceEntries([
    entry('event', 'Task started'),
    entry('context', '<skills_instructions>\n## Skills\n</skills_instructions>'),
    entry('context', 'You are `/root`, the primary agent.'),
    entry('context', '<permissions instructions>\nSandbox\n</permissions instructions>'),
    entry('user', 'Fix the failing build'),
  ]);
  assert.deepEqual(groups.map((group) => [group.kind, group.blocks.map((block) => block.type)]), [
    ['event', ['event']],
    ['context', ['context', 'context', 'context']],
    ['user', ['text']],
  ]);
  const labels = groups[1].blocks.map((block) => (block.type === 'context' ? contextLabel(block.entry.text) : ''));
  assert.deepEqual(labels, ['skills_instructions', 'Instructions', 'permissions instructions']);
  assert.deepEqual(filterConversationGroups(groups, '', 'context').map((group) => group.kind), ['context']);
});
