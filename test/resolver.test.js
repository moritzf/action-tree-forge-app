import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/index.js';

test('the actual Forge SDK initializes and rejects calls without trusted issue context', async () => {
  assert.equal(typeof handler, 'function');
  const result = await handler({ call: { functionKey: 'inspect' }, context: {} });
  assert.match(result.error, /Open Action Tree from a Jira Task issue/);
});
