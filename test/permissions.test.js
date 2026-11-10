import test from 'node:test';
import assert from 'node:assert/strict';
import { checkForgePermissions } from '../scripts/check-forge-permissions.mjs';

test('normal changes deploy without requesting permission approval', () => {
  let calls = 0;
  assert.equal(checkForgePermissions(() => { calls++; return { status: 0, stdout: 'No issues found.' }; }), false);
  assert.equal(calls, 1);
});

test('major version changes require review only after all other checks pass', () => {
  const calls = [];
  assert.equal(checkForgePermissions((args) => {
    calls.push(args);
    return args.length ? { status: 0 } : { status: 1, stdout: 'approval MAJOR_VERSION_RULE' };
  }), true);
  assert.deepEqual(calls, [[], ['--approve', 'MAJOR_VERSION_RULE']]);
});

test('unrelated failures cannot become successful deployments or approval requests', () => {
  assert.throws(() => checkForgePermissions(() => ({ status: 1, stderr: 'Authentication failed' })), /deployment is blocked/);
  assert.throws(() => checkForgePermissions((args) => args.length
    ? { status: 1, stdout: 'Invalid manifest' }
    : { status: 1, stdout: 'Invalid manifest and MAJOR_VERSION_RULE' }), /additional problems/);
  assert.throws(() => checkForgePermissions(() => ({ status: null })), /could not run/);
});
