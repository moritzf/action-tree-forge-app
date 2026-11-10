import test from 'node:test';
import assert from 'node:assert/strict';
import { conversionService, digest } from '../src/conversion.js';

const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const list = { type: 'bulletList', content: [
  { type: 'listItem', content: [p('Parent'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('Child')] }] }] },
] };
function fixture() {
  const values = new Map();
  const state = { id: '1', key: 'T-1', fields: { issuetype: { id: '100', name: 'Task', subtask: false }, description: { type: 'doc', version: 1, content: [list, p('Keep me')] } } };
  const calls = { created: [], links: [], updates: 0 };
  const store = {
    get: async (key) => structuredClone(values.get(key)),
    set: async (key, value) => values.set(key, structuredClone(value)),
    delete: async (key) => values.delete(key),
    claim: async (key, value) => { if (values.has(key)) throw new Error('Claim exists'); values.set(key, value); },
  };
  const jira = {
    getIssue: async () => structuredClone(state),
    preflight: async () => ({ projectId: '10', taskTypeId: '100', baseUrl: 'https://example.atlassian.net', linkType: { id: '20', inward: 'is subtask of', outward: 'has subtask' } }),
    createTask: async (...args) => { calls.created.push(args); return { key: `T-${calls.created.length + 1}` }; },
    ensureLink: async (body) => { calls.links.push(body); },
    updateDescription: async (_, description) => { calls.updates++; state.fields.description = description; },
  };
  return { service: conversionService({ jira, store }), state, calls, jira, values };
}

test('create, link, resume and replace use Task type and the source as root parent', async () => {
  const f = fixture();
  await f.service.begin('1', 0, digest(list));
  await f.service.step('1');
  assert.equal((await f.service.inspect('1')).run.nodes[0].key, 'T-2');
  await f.service.step('1');
  const finished = await f.service.step('1');
  assert.equal(finished.done, true);
  assert.deepEqual(f.calls.created.map((args) => args.slice(0, 3)), [['10', '100', 'Parent'], ['10', '100', 'Child']]);
  assert.deepEqual(f.calls.links.map((body) => [body.inwardIssue.key, body.outwardIssue.key]), [['T-1', 'T-2'], ['T-2', 'T-3']]);
  await f.service.step('1');
  assert.equal(f.calls.created.length, 2);
  assert.equal(f.calls.updates, 1);
  assert.deepEqual(f.state.fields.description.content[1], p('Keep me'));
});

test('identical lists in separate conversions do not reuse persistent creation claims', async () => {
  const f = fixture();
  const first = await f.service.begin('1', 0, digest(list));
  await f.service.step('1');
  await f.service.step('1');
  await f.service.step('1');

  // Reinsert the same content at the same position after the first conversion.
  f.state.fields.description.content[0] = structuredClone(list);
  const second = await f.service.begin('1', 0, digest(list));
  assert.notEqual(second.id, first.id);
  // Reopening an unfinished conversion must still reuse its original identity.
  assert.equal((await f.service.begin('1', 0, digest(list))).id, second.id);
  await f.service.step('1');
  await f.service.step('1');
  assert.equal((await f.service.step('1')).done, true);
  assert.equal(f.calls.created.length, 4);
  assert.equal(f.calls.updates, 2);
  assert.equal(f.calls.created[2][3].run, second.id);
});

test('native checkbox actions convert with nested links and retain original completion metadata', async () => {
  const f = fixture();
  const actionList = { type: 'taskList', attrs: { localId: 'root' }, content: [
    { type: 'taskItem', attrs: { localId: 'parent', state: 'DONE' }, content: [{ type: 'text', text: 'Parent' }] },
    { type: 'taskList', attrs: { localId: 'nested' }, content: [
      { type: 'taskItem', attrs: { localId: 'child', state: 'TODO' }, content: [{ type: 'text', text: 'Child' }] },
    ] },
  ] };
  f.state.fields.description.content[0] = actionList;
  const preview = await f.service.inspect('1');
  assert.equal(preview.lists[0].label, 'Parent (2 actions)');
  await f.service.begin('1', 0, preview.lists[0].hash);
  await f.service.step('1');
  await f.service.step('1');
  const done = await f.service.step('1');
  assert.equal(done.done, true);
  assert.deepEqual(f.calls.created.map((args) => args[3].actionState), ['DONE', 'TODO']);
  assert.deepEqual(f.calls.links.map((body) => [body.inwardIssue.key, body.outwardIssue.key]), [['T-1', 'T-2'], ['T-2', 'T-3']]);
  assert.equal(f.state.fields.description.content[0].type, 'bulletList');
  assert.equal(f.state.fields.description.content[0].content[0].content[0].content[0].type, 'inlineCard');
  assert.deepEqual(f.state.fields.description.content[1], p('Keep me'));
});

test('failed link retries without recreating the already saved Task', async () => {
  const f = fixture();
  await f.service.begin('1', 0, digest(list));
  const link = f.jira.ensureLink;
  f.jira.ensureLink = async () => { throw new Error('Permission denied'); };
  await assert.rejects(f.service.step('1'), /Permission/);
  f.jira.ensureLink = link;
  await f.service.step('1');
  assert.equal(f.calls.created.length, 1);
});

test('uncertain create is never automatically repeated', async () => {
  const f = fixture();
  await f.service.begin('1', 0, digest(list));
  let attempts = 0;
  f.jira.createTask = async () => { attempts++; throw new Error('Network timeout'); };
  await assert.rejects(f.service.step('1'), /Network timeout/);
  await assert.rejects(f.service.step('1'), /uncertain/);
  assert.equal(attempts, 1);
});

test('a definitive Jira rejection permits a corrected retry', async () => {
  const f = fixture();
  await f.service.begin('1', 0, digest(list));
  const create = f.jira.createTask;
  f.jira.createTask = async () => { throw Object.assign(new Error('Required field'), { definitive: true }); };
  await assert.rejects(f.service.step('1'), /Required field/);
  f.jira.createTask = create;
  await f.service.step('1');
  assert.equal(f.calls.created.length, 1);
});

test('stale preview and non-Task issues cannot start a conversion', async () => {
  const f = fixture();
  await assert.rejects(f.service.begin('1', 0, 'stale'), /list changed/);
  f.state.fields.issuetype.name = 'Bug';
  await assert.rejects(f.service.begin('1', 0, digest(list)), /Task issues only/);
  assert.equal(f.calls.created.length, 0);
});

test('concurrent source-list edits are preserved and the run remains resumable', async () => {
  const f = fixture();
  await f.service.begin('1', 0, digest(list));
  await f.service.step('1');
  await f.service.step('1');
  f.state.fields.description.content[0] = p('Edited by another user');
  await assert.rejects(f.service.step('1'), /source list changed/);
  assert.equal(f.calls.updates, 0);
  assert.equal(f.calls.created.length, 2);
});

test('recovery accepts only a Task with the exact source/run/item origin', async () => {
  const f = fixture();
  const run = await f.service.begin('1', 0, digest(list));
  const getIssue = f.jira.getIssue;
  f.jira.getIssue = async (key) => key === 'T-99' ? { key, fields: { project: { id: '10' }, issuetype: { id: '100' } } } : getIssue(key);
  f.jira.getOrigin = async () => ({ source: 'T-1', run: 'wrong', index: 0 });
  await assert.rejects(f.service.recover('1', 'T-99'), /not created for/);
  f.jira.getOrigin = async () => ({ source: 'T-1', run: run.id, index: 0 });
  assert.equal((await f.service.recover('1', 'T-99')).nodes[0].key, 'T-99');
  await f.service.step('1');
  assert.equal(f.calls.created.length, 0);
});
