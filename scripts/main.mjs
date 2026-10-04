// Copyright 2026 Heapy
// SPDX-License-Identifier: Apache-2.0

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { bool, names, executable, projectDirectory, run, requireToolchain, output, summary, escapeCommand, escapeMarkdown } from './common.mjs';

export function checkArguments(env) {
  return ['check', ...names(env.INPUT_CHECKS || '', 'checks'),
    ...names(env.INPUT_MODULES || '', 'modules').flatMap(name => ['--module', name]),
    ...names(env.INPUT_SKIP || '', 'skip').flatMap(name => ['--skip', name])];
}
function commands(env, build) {
  const platforms = names(env.INPUT_PLATFORMS || '', 'platforms').flatMap(name => ['--platform', name]);
  const modules = names(env.INPUT_MODULES || '', 'modules');
  const moduleArgs = modules.flatMap(name => ['--module', name]);
  // Validate every input before starting the CLI, including when no command will run.
  const checkArgs = checkArguments(env);
  const result = build ? [['build', ...moduleArgs, ...platforms]] : [];
  if (!platforms.length) return [...result, checkArgs];

  const checks = names(env.INPUT_CHECKS || '', 'checks');
  const skip = names(env.INPUT_SKIP || '', 'skip');
  // `check` has no platform option in Toolchain 0.13. Run its built-in tests through
  // `test` so the selected targets are honored, and exclude them from plugin checks.
  if ((!checks.length || checks.includes('tests')) && !skip.includes('tests')) {
    result.push(['test', ...modules.flatMap(name => ['--include-module', name]), ...platforms]);
  }
  if (!checks.length) {
    // A tests-only project reports an error for `check --skip tests`. Discover
    // plugin checks first using the CLI's plain, qualified-name output.
    result.push(['show', 'checks', '--format', 'plain', ...moduleArgs]);
    result.push(['check', ...moduleArgs,
      ...[...new Set([...skip, 'tests'])].flatMap(name => ['--skip', name])]);
  } else {
    const pluginChecks = checks.filter(name => name !== 'tests' &&
      !skip.some(skipped => skipped === name || (!skipped.includes(':') && name.split(':').at(-1) === skipped)));
    // The CLI rejects positional check names together with --skip. Explicitly
    // selected plugin checks already exclude built-in tests.
    if (pluginChecks.length) result.push(['check', ...pluginChecks, ...moduleArgs]);
  }
  return result;
}
export function parseReport(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD/entity declarations are not allowed in test reports');
  if (XMLValidator.validate(xml) !== true) throw new Error('Malformed test report XML');
  const document = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false,
    isArray: name => ['testsuite', 'testcase', 'failure', 'error'].includes(name) }).parse(xml);
  const result = { tests: 0, failures: 0, errors: 0, skipped: 0, messages: [] };
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    for (const test of node.testcase || []) {
      result.tests++;
      if ('skipped' in test) result.skipped++;
      if ('failure' in test) result.failures++;
      if ('error' in test) result.errors++;
      if ('failure' in test || 'error' in test) result.messages.push(`${test['@_classname'] || ''}.${test['@_name'] || 'unnamed test'}`);
    }
    for (const suite of node.testsuite || []) visit(suite);
    if (node.testsuites) visit(node.testsuites);
  }
  visit(document);
  return result;
}
export async function reportFiles(root, depth = 0) {
  if (depth > 20) throw new Error('Report directory nesting is too deep');
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await reportFiles(file, depth + 1));
    else if (entry.isFile() && /^TEST-.*\.xml$/.test(entry.name)) files.push(file);
    if (files.length > 1000) throw new Error('Too many test reports');
  }
  return files;
}
export async function check(env = process.env) {
  const cwd = await projectDirectory(env.INPUT_DIRECTORY, env);
  const build = bool(env.INPUT_BUILD ?? 'true', 'build');
  bool(env.INPUT_UPLOAD ?? 'true', 'upload-reports');
  const timeoutMinutes = env.INPUT_COMMAND_TIMEOUT_MINUTES ?? '20';
  const timeout = Number(timeoutMinutes) * 60_000;
  if (!/^\d+$/.test(timeoutMinutes) || !Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error('command-timeout-minutes must be a positive integer');
  }
  const invocations = commands(env, build);
  const cli = await executable(cwd, env);
  const toolchain = requireToolchain(cli, cwd, env, timeout);
  const started = Date.now();
  let exitCode = 0;
  for (const args of invocations) {
    const result = run(cli, args, { cwd, env, timeout, quiet: args[0] === 'show' });
    exitCode = result.status;
    if (exitCode) break;
    if (args[0] === 'show' && !names(result.stdout, 'available checks').some(name => name !== 'tests')) break;
  }
  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  let reports = 0, parseErrors = 0;
  for (const file of await reportFiles(path.join(cwd, 'build', 'reports'))) {
    const info = await stat(file);
    // Ignore reports left over from an earlier invocation in the same workspace.
    if (info.mtimeMs < started - 1000) continue;
    try {
      if (info.size > 10 * 1024 * 1024) throw new Error('Test report exceeds 10 MiB');
      const report = parseReport(await readFile(file, 'utf8'));
      reports++;
      for (const key of Object.keys(totals)) totals[key] += report[key];
      for (const message of report.messages.slice(0, 20)) console.log(`::error::${escapeCommand(`Test failed: ${message}`)}`);
    } catch (error) {
      parseErrors++;
      console.log(`::warning::${escapeCommand(`Cannot read test report ${path.basename(file)}: ${error.message}`)}`);
    }
  }
  if (totals.failures || totals.errors || parseErrors) exitCode ||= 1;
  for (const [name, value] of Object.entries({ ...totals, reports, 'exit-code': exitCode, 'reports-path': path.join(cwd, 'build', 'reports') })) await output(name, value, env);
  await summary(`### Kotlin Toolchain checks\n\n${escapeMarkdown(toolchain)}\n\nResult: **${exitCode ? 'failed' : 'passed'}**\n\n| Tests | Failed | Errors | Skipped | Reports |\n|---:|---:|---:|---:|---:|\n| ${totals.tests} | ${totals.failures} | ${totals.errors} | ${totals.skipped} | ${reports} |\n\n${reports ? '' : 'No fresh JUnit XML reports were produced. Check status comes from the CLI exit code.\n'}`, env);
  if (exitCode) console.log(`::error::Kotlin Toolchain checks failed (exit ${exitCode})`);
  return exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  check().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
