import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, checkArguments } from '../scripts/main.mjs';
import { escapeCommand } from '../scripts/common.mjs';

test('counts nested JUnit cases without double-counting aggregate suites', () => {
  const result = parseReport(`<testsuites tests="999"><testsuite tests="999"><testcase name="pass"/><testcase name="fail" classname="A"><failure message="bad"/></testcase><testsuite><testcase name="error"><error/></testcase><testcase name="skip"><skipped/></testcase></testsuite></testsuite></testsuites>`);
  assert.deepEqual(result, { tests: 4, failures: 1, errors: 1, skipped: 1, messages: ['A.fail', '.error'] });
});
test('supports empty suites, entity escaping, and refuses malformed/external entities', () => {
  assert.equal(parseReport('<testsuite/>').tests, 0);
  assert.equal(parseReport('<testsuite><testcase name="a &amp; b"><failure/></testcase></testsuite>').messages[0], '.a & b');
  assert.throws(() => parseReport('<testsuite>'));
  assert.throws(() => parseReport('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuite/>'));
  assert.equal(escapeCommand('test\n::notice::injected'), 'test%0A::notice::injected');
});
test('CLI arguments stay separate and reject flags injected as names', () => {
  assert.deepEqual(checkArguments({ INPUT_CHECKS: 'tests,lint', INPUT_MODULES: 'app\nlib', INPUT_SKIP: 'api' }), ['check','tests','lint','--module','app','--module','lib','--skip','api']);
  assert.throws(() => checkArguments({ INPUT_MODULES: '--project-dir=/tmp' }));
});
