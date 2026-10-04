import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { check } from '../scripts/main.mjs';

async function fixture(t, inputs = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ktc-check-platforms-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('Kotlin Toolchain version 0.13.0');
} else {
  appendFileSync(process.env.FAKE_CLI_COMMANDS, JSON.stringify(args) + '\\n');
  if (args[0] === 'show') console.log(process.env.FAKE_AVAILABLE_CHECKS ?? 'tests\\nlint');
  if (args[0] === process.env.FAKE_CLI_FAIL_COMMAND) process.exit(Number(process.env.FAKE_CLI_FAIL_STATUS));
}
`;
  await writeFile(path.join(directory, 'fake-cli.mjs'), script);
  if (process.platform === 'win32') {
    await writeFile(path.join(directory, 'kotlin.bat'), `@"${process.execPath}" "%~dp0fake-cli.mjs" %*\r\n`);
  } else {
    const cli = path.join(directory, 'kotlin');
    await writeFile(cli, `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$(dirname "$0")/fake-cli.mjs" "$@"\n`);
    await chmod(cli, 0o755);
  }
  const commandsFile = path.join(directory, 'commands.jsonl');
  await writeFile(commandsFile, '');
  const env = { ...process.env, GITHUB_ACTIONS: '', GITHUB_WORKSPACE: directory,
    KOTLIN_TOOLCHAIN_BIN: directory, GITHUB_OUTPUT: path.join(directory, 'outputs'),
    GITHUB_STEP_SUMMARY: path.join(directory, 'summary'), FAKE_CLI_COMMANDS: commandsFile, ...inputs };
  return { env, commands: async () => (await readFile(commandsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
}

test('an empty platforms input preserves the existing build and check commands', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: '', INPUT_MODULES: 'app,lib', INPUT_CHECKS: 'tests,lint', INPUT_SKIP: 'api' });
  assert.equal(await check(f.env), 0);
  assert.deepEqual(await f.commands(), [
    ['build', '--module', 'app', '--module', 'lib'],
    ['check', 'tests', 'lint', '--module', 'app', '--module', 'lib', '--skip', 'api'],
  ]);
});

test('multiple platforms scope the build and built-in tests without rerunning unfiltered tests', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'linuxX64,\njvm', INPUT_MODULES: 'app lib', INPUT_CHECKS: 'tests' });
  assert.equal(await check(f.env), 0);
  assert.deepEqual(await f.commands(), [
    ['build', '--module', 'app', '--module', 'lib', '--platform', 'linuxX64', '--platform', 'jvm'],
    ['test', '--include-module', 'app', '--include-module', 'lib', '--platform', 'linuxX64', '--platform', 'jvm'],
  ]);
});

test('default checks retain plugin checks while skipping the already scoped built-in tests', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'jvm', INPUT_BUILD: 'false', INPUT_MODULES: 'app', INPUT_SKIP: 'api' });
  assert.equal(await check(f.env), 0);
  assert.deepEqual(await f.commands(), [
    ['test', '--include-module', 'app', '--platform', 'jvm'],
    ['show', 'checks', '--format', 'plain', '--module', 'app'],
    ['check', '--module', 'app', '--skip', 'api', '--skip', 'tests'],
  ]);
});

test('explicit plugin checks are preserved alongside platform-scoped tests', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'jvm', INPUT_BUILD: 'false', INPUT_CHECKS: 'tests lint', INPUT_SKIP: 'api' });
  assert.equal(await check(f.env), 0);
  assert.deepEqual(await f.commands(), [
    ['test', '--platform', 'jvm'],
    ['check', 'lint'],
  ]);
});

test('skipping tests runs only the remaining checks', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'jvm', INPUT_BUILD: 'false', INPUT_CHECKS: 'tests lint', INPUT_SKIP: 'tests' });
  assert.equal(await check(f.env), 0);
  assert.deepEqual(await f.commands(), [['check', 'lint']]);
});

test('selecting only plugin checks does not implicitly run tests', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'jvm', INPUT_BUILD: 'false', INPUT_CHECKS: 'lint' });
  assert.equal(await check(f.env), 0);
  assert.deepEqual(await f.commands(), [['check', 'lint']]);
});

test('selecting and skipping only tests never falls back to all checks', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'jvm', INPUT_BUILD: 'false', INPUT_CHECKS: 'tests', INPUT_SKIP: 'tests' });
  assert.equal(await check(f.env), 0);
  assert.deepEqual(await f.commands(), []);
});

test('default checks in a tests-only project do not invoke an empty plugin check', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'jvm', INPUT_BUILD: 'false', FAKE_AVAILABLE_CHECKS: 'tests' });
  assert.equal(await check(f.env), 0);
  assert.deepEqual(await f.commands(), [['test', '--platform', 'jvm'], ['show', 'checks', '--format', 'plain']]);
});

test('skipped plugin checks are removed by simple or qualified names', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'jvm', INPUT_BUILD: 'false', INPUT_CHECKS: 'one:lint two:api three:keep', INPUT_SKIP: 'lint two:api' });
  assert.equal(await check(f.env), 0);
  assert.deepEqual(await f.commands(), [['check', 'three:keep']]);
});

test('check discovery failures fail the action without running plugin checks', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'jvm', INPUT_BUILD: 'false', FAKE_CLI_FAIL_COMMAND: 'show', FAKE_CLI_FAIL_STATUS: '4' });
  assert.equal(await check(f.env), 4);
  assert.deepEqual(await f.commands(), [['test', '--platform', 'jvm'], ['show', 'checks', '--format', 'plain']]);
});

test('a failed scoped test stops subsequent checks and preserves its exit status without XML', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'linuxX64', INPUT_BUILD: 'false', FAKE_CLI_FAIL_COMMAND: 'test', FAKE_CLI_FAIL_STATUS: '7' });
  assert.equal(await check(f.env), 7);
  assert.deepEqual(await f.commands(), [['test', '--platform', 'linuxX64']]);
  assert.match(await readFile(f.env.GITHUB_OUTPUT, 'utf8'), /exit-code=7\n/);
  assert.match(await readFile(f.env.GITHUB_STEP_SUMMARY, 'utf8'), /No fresh JUnit XML reports/);
});

test('a failed platform-scoped build stops tests and checks', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'jvm', FAKE_CLI_FAIL_COMMAND: 'build', FAKE_CLI_FAIL_STATUS: '3' });
  assert.equal(await check(f.env), 3);
  assert.deepEqual(await f.commands(), [['build', '--platform', 'jvm']]);
});

test('platform values cannot inject CLI options', async t => {
  const f = await fixture(t, { INPUT_PLATFORMS: 'jvm --project-dir=/tmp' });
  await assert.rejects(check(f.env), /Invalid platforms/);
  assert.deepEqual(await f.commands(), []);
});
