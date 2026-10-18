import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

// Acceptance check for run names: hovering a run's folder line shows the
// agent's own title, double-clicking it renames the run (Enter saves,
// Escape cancels), and names survive a restart in the app's own file.

const require = createRequire(import.meta.url);
const electronExecutable = process.env.ELECTRON_EXECUTABLE_PATH || require('electron');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timeoutMs = Number(process.env.AGENT_MONITOR_SMOKE_TIMEOUT_MS) || 20_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(description, predicate, timeout = timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const value = await predicate().catch(() => undefined);
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

const line = value => `${JSON.stringify(value)}\n`;

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-monitor-run-names-'));
  const userData = path.join(tempRoot, 'user-data');
  const root = path.join(tempRoot, 'sessions');
  let electronApp;
  const launch = async () => {
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [projectRoot, `--user-data-dir=${userData}`],
      env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: root, HOME: path.join(tempRoot, 'home') },
    });
    return electronApp.firstWindow();
  };
  try {
    const codexCwd = path.join(tempRoot, 'work', 'artem');
    const claudeCwd = path.join(tempRoot, 'work', 'blog');
    await mkdir(path.join(root, 'blog'), { recursive: true });
    await writeFile(path.join(root, 'codex-thread.jsonl'), line({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'codex-thread', cwd: codexCwd, model_provider: 'openai', thread_source: 'user' } }));
    // Codex keeps thread names next to its sessions directory.
    await writeFile(path.join(tempRoot, 'session_index.jsonl'), line({ id: 'codex-thread', thread_name: 'Check the SSH connection' }));
    await writeFile(path.join(root, 'blog', 'claude-session.jsonl'),
      line({ type: 'user', sessionId: 'claude-session', uuid: 'u1', cwd: claudeCwd, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Hi' } })
      + line({ type: 'ai-title', aiTitle: 'First title', sessionId: 'claude-session' })
      + line({ type: 'ai-title', aiTitle: 'Latest title', sessionId: 'claude-session' }));

    let page = await launch();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error));
    const label = cwd => page.locator(`button.run-item .run-item__path[data-cwd="${cwd}"]`);
    const popup = () => page.locator('.run-title-popup');
    await waitFor('both runs', async () => await page.locator('button.run-item').count() === 2);

    // Hovering the folder line shows the agent's own title.
    await label(codexCwd).hover();
    await waitFor('the Codex title', async () => (await popup().innerText()).includes('Check the SSH connection'));
    if (!(await popup().innerText()).includes(codexCwd)) throw new Error('the popup does not show the folder');
    await label(claudeCwd).hover();
    await waitFor('the latest Claude title', async () => (await popup().innerText()).includes('Latest title'));

    // Double-click renames; Enter saves.
    await label(codexCwd).dblclick();
    const input = page.getByRole('textbox', { name: 'Run name' });
    await input.fill('VPS review');
    await input.press('Enter');
    await waitFor('the saved name', async () => (await label(codexCwd).innerText()).replace(/\s+/g, ' ').trim() === 'VPS review · artem');

    // The run search finds a run by its name.
    const search = page.getByRole('searchbox', { name: 'Search runs' });
    await search.fill('vps');
    await waitFor('the run found by name', async () => await page.locator('button.run-item').count() === 1
      && (await page.locator('button.run-item mark').innerText()) === 'VPS');
    await search.fill('');

    // Escape cancels an edit.
    await label(codexCwd).dblclick();
    if (await input.inputValue() !== 'VPS review') throw new Error('the editor does not start from the current name');
    await input.fill('Something else');
    await input.press('Escape');
    await waitFor('the edit cancelled', async () => !await input.isVisible() && (await label(codexCwd).innerText()).includes('VPS review'));

    // Names survive a restart and live in the app's own file.
    await electronApp.close();
    page = await launch();
    page.on('pageerror', error => pageErrors.push(error));
    await waitFor('the name after restart', async () => (await label(codexCwd).innerText()).includes('VPS review'));
    const stored = JSON.parse(await readFile(path.join(userData, 'run-names.json'), 'utf8'));
    if (stored['codex-thread'] !== 'VPS review') throw new Error(`unexpected names file: ${JSON.stringify(stored)}`);

    // An empty name removes it.
    await label(codexCwd).dblclick();
    await page.getByRole('textbox', { name: 'Run name' }).fill('');
    await page.getByRole('textbox', { name: 'Run name' }).press('Enter');
    await waitFor('the folder name back', async () => (await label(codexCwd).innerText()).trim() === 'artem');

    if (pageErrors.length) throw new Error(`renderer errors: ${pageErrors.map(String).join('; ')}`);
    console.log('PASS: runs show the agent title on hover and can be renamed in place, kept across restarts');
  } finally {
    await electronApp?.close().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
