import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { check } from '../scripts/main.mjs';

async function fixture(t, inputs = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ktc-check-timeout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = path.join(directory, process.platform === 'win32' ? 'kotlin.bat' : 'kotlin');
  await writeFile(cli, '');
  await chmod(cli, 0o755);
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    calls.push({ command, args, options });
    const invocation = args.join(' ');
    return { status: 0, stderr: '', stdout: invocation.includes('--version')
      ? 'Kotlin Toolchain version 0.13.0\n'
      : invocation.includes('show') ? 'tests\nlint\n' : '' };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const env = { ...process.env, GITHUB_ACTIONS: '', GITHUB_WORKSPACE: directory,
    KOTLIN_TOOLCHAIN_BIN: directory, GITHUB_OUTPUT: path.join(directory, 'outputs'),
    GITHUB_STEP_SUMMARY: path.join(directory, 'summary'), ...inputs };
  delete env.INPUT_COMMAND_TIMEOUT_MINUTES;
  Object.assign(env, inputs);
  return { env, calls };
}

test('default timeout gives build and checks separate 20-minute limits', async t => {
  const f = await fixture(t);
  assert.equal(await check(f.env), 0);
  assert.equal(f.calls.length, 3); // Version, build, check.
  assert.deepEqual(f.calls.map(call => call.options.timeout), [1_200_000, 1_200_000, 1_200_000]);
});

test('custom timeout reaches every platform-scoped CLI invocation in milliseconds', async t => {
  const f = await fixture(t, { INPUT_COMMAND_TIMEOUT_MINUTES: '60', INPUT_PLATFORMS: 'jvm' });
  assert.equal(await check(f.env), 0);
  assert.equal(f.calls.length, 5); // Version, build, test, discovery, plugin checks.
  assert.ok(f.calls.every(call => call.options.timeout === 3_600_000));
});

test('custom timeout still applies when build is disabled', async t => {
  const f = await fixture(t, { INPUT_COMMAND_TIMEOUT_MINUTES: '40', INPUT_BUILD: 'false' });
  assert.equal(await check(f.env), 0);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.options.timeout === 2_400_000));
});

test('invalid timeout inputs fail before launching any CLI command', async t => {
  const f = await fixture(t);
  for (const value of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '20minutes', '1e2', '9007199254740991']) {
    await assert.rejects(check({ ...f.env, INPUT_COMMAND_TIMEOUT_MINUTES: value }),
      /command-timeout-minutes must be a positive integer/);
  }
  assert.equal(f.calls.length, 0);
});
