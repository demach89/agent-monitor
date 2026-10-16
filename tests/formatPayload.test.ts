import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPayload, payloadPreview, payloadText } from '../src/renderer/formatPayload';

test('text that is not a JSON object stays text', () => {
  assert.deepEqual(formatPayload('ls -la\nexit 0'), { kind: 'text', text: 'ls -la\nexit 0' });
  assert.deepEqual(formatPayload('{"broken": '), { kind: 'text', text: '{"broken": ' });
  assert.deepEqual(formatPayload('[1, 2]'), { kind: 'text', text: '[1, 2]' });
  // Content-part arrays read as their text.
  assert.deepEqual(formatPayload('[{"type":"input_text","text":"Script completed\\nWall time 1s"}]'), { kind: 'text', text: 'Script completed\nWall time 1s' });
});

test('a shell call shows its description and the command as a block', () => {
  const view = formatPayload('{"command":"cd /tmp &&\\n  ls -la","description":"List temp files","timeout":120000}');
  assert.deepEqual(view, {
    kind: 'command',
    description: 'List temp files',
    command: 'cd /tmp &&\n  ls -la',
    fields: [{ key: 'timeout', value: { kind: 'scalar', text: '120000' } }],
  });
  assert.equal(payloadPreview(view), 'List temp files');
  assert.equal(payloadText(view), 'List temp files\n\ncd /tmp &&\n  ls -la\n\ntimeout: 120000');
});

test('an edit shows the file and the text before and after', () => {
  const view = formatPayload('{"file_path":"/repo/a.ts","old_string":"const a = 1;\\n","new_string":"const a = 2;\\n","replace_all":false}');
  assert.deepEqual(view, {
    kind: 'edit',
    path: '/repo/a.ts',
    before: 'const a = 1;\n',
    after: 'const a = 2;\n',
    fields: [{ key: 'replace_all', value: { kind: 'scalar', text: 'false' } }],
  });
  assert.equal(payloadPreview(view), '/repo/a.ts');
});

test('a written file shows its path and content', () => {
  const view = formatPayload('{"file_path":"/repo/notes.md","content":"# Notes\\n\\n- one"}');
  assert.deepEqual(view, { kind: 'file', path: '/repo/notes.md', content: '# Notes\n\n- one', fields: [] });
  assert.equal(payloadPreview(view), '/repo/notes.md');
});

test('other objects show their fields with real line breaks, nesting and lists', () => {
  const view = formatPayload('{"stdout":"35883\\tlangfuse\\n32362\\tsignoz","code":0,"meta":{"ok":true},"tags":["a","b"],"items":[{"id":1}]}');
  assert.deepEqual(view, {
    kind: 'fields',
    fields: [
      { key: 'stdout', value: { kind: 'block', text: '35883\tlangfuse\n32362\tsignoz' } },
      { key: 'code', value: { kind: 'scalar', text: '0' } },
      { key: 'meta', value: { kind: 'fields', fields: [{ key: 'ok', value: { kind: 'scalar', text: 'true' } }] } },
      { key: 'tags', value: { kind: 'scalar', text: 'a, b' } },
      { key: 'items', value: { kind: 'block', text: '[\n  {\n    "id": 1\n  }\n]' } },
    ],
  });
  assert.equal(payloadPreview(view), 'stdout: 35883 langfuse 32362 signoz');
  assert.equal(payloadText(view).split('\n')[0], 'stdout:');
});

test('long single-line strings become blocks, short ones stay inline', () => {
  const long = 'x'.repeat(120);
  const view = formatPayload(JSON.stringify({ prompt: long, subagent_type: 'Explore' }));
  assert.deepEqual(view, {
    kind: 'fields',
    fields: [
      { key: 'prompt', value: { kind: 'block', text: long } },
      { key: 'subagent_type', value: { kind: 'scalar', text: 'Explore' } },
    ],
  });
});
