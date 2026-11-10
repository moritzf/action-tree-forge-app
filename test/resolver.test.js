import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/index.ts';

test('the actual Forge SDK initializes and rejects calls without trusted issue context', async () => {
  assert.equal(typeof handler, 'function');
  const result = await handler({ call: { functionKey: 'inspect' }, context: {} });
  assert.match(result.error, /Open Action Tree from a Jira Task issue/);
});

test('resolver payloads are validated before accessing storage or Jira', async () => {
  const context = { extension: { issue: { id: '1' } } };
  const runtime = { principal: { accountId: 'user' } };
  for (const payload of [undefined, null, {}, { index: '0', hash: 'preview' }, { index: 0.5, hash: 'preview' }]) {
    const result = await handler({ call: { functionKey: 'begin', payload }, context }, runtime);
    assert.match(result.error, /Choose a list/);
  }
  const result = await handler({ call: { functionKey: 'recover', payload: { key: 123 } }, context }, runtime);
  assert.match(result.error, /existing Jira issue key/);
});
