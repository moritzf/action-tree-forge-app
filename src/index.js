import { makeResolver } from '@forge/resolver';
import { kvs } from '@forge/kvs';
import { conversionService } from './conversion.js';
import { jira } from './jira.js';

const store = {
  get: (key) => kvs.get(key),
  set: (key, value) => kvs.set(key, value),
  delete: (key) => kvs.delete(key),
  claim: (key, value) => kvs.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS' }),
};
const service = conversionService({ jira, store });
const definitions = {};
const CONVERSION_LEASE_SECONDS = 60;

function issueId(context) {
  const id = context.extension?.issue?.id;
  if (!id || !context.accountId) throw new Error('Open Action Tree from a Jira Task issue.');
  return id;
}

async function locked(id, operation) {
  const key = `lock:${id}`;
  try {
    // The lease outlasts a UI resolver invocation. Expiry recovers an interrupted process.
    await kvs.set(key, true, {
      keyPolicy: 'FAIL_IF_EXISTS',
      ttl: { value: CONVERSION_LEASE_SECONDS, unit: 'SECONDS' },
    });
  } catch {
    throw new Error('A conversion is already running. Wait one minute before resuming.');
  }
  try {
    return await operation();
  } finally {
    await kvs.delete(key);
  }
}

// Return errors explicitly: bridge errors otherwise hide useful Jira permission messages.
function define(name, operation) {
  definitions[name] = async (request) => {
    try {
      return { data: await operation(request, issueId(request.context)) };
    } catch (error) {
      return { error: error.message };
    }
  };
}

define('inspect', (_, id) => service.inspect(id));
define('begin', ({ payload }, id) => locked(id, () => service.begin(id, payload.index, payload.hash)));
define('step', (_, id) => locked(id, () => service.step(id)));
define('recover', ({ payload }, id) => locked(id, () => service.recover(id, payload.key)));

export const handler = makeResolver(definitions);
