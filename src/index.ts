import { makeResolver } from '@forge/resolver';
import type { Request } from '@forge/resolver';
import type { ConversionStore } from './types';
import { errorMessage } from './errors';
import { kvs } from '@forge/kvs';
import { conversionService } from './conversion';
import { jira } from './jira';

const store: ConversionStore = {
  get: <T>(key: string) => kvs.get<T>(key),
  set: (key, value) => kvs.set(key, value),
  delete: (key) => kvs.delete(key),
  claim: (key, value) => kvs.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS' }),
};
const service = conversionService({ jira, store });
const CONVERSION_LEASE_SECONDS = 60;

function issueId(context: { extension?: { issue?: { id?: string } }; accountId?: string }): string {
  const id = context.extension?.issue?.id;
  if (!id || !context.accountId) throw new Error('Open Action Tree from a Jira Task issue.');
  return id;
}

async function locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
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
function define<T>(operation: (request: Request<unknown>, id: string) => Promise<T>) {
  return async (request: Request<unknown>): Promise<{ data: T } | { error: string }> => {
    try {
      return { data: await operation(request, issueId(request.context)) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  };
}

const definitions = {
  inspect: define((_, id) => service.inspect(id)),
  begin: define(({ payload }, id) => {
    if (!payload || typeof payload !== 'object' ||
      !('index' in payload) || !Number.isInteger(payload.index) || typeof payload.index !== 'number' ||
      !('hash' in payload) || typeof payload.hash !== 'string') {
      throw new Error('Choose a list from the current preview.');
    }
    const { index, hash } = payload;
    return locked(id, () => service.begin(id, index, hash));
  }),
  step: define((_, id) => locked(id, () => service.step(id))),
  recover: define(({ payload }, id) => {
    if (!payload || typeof payload !== 'object' || !('key' in payload) || typeof payload.key !== 'string') {
      throw new Error('Enter an existing Jira issue key.');
    }
    const { key } = payload;
    return locked(id, () => service.recover(id, key));
  }),
};

export const handler = makeResolver(definitions);
