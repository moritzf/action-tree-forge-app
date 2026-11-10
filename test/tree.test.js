import test from 'node:test';
import assert from 'node:assert/strict';
import { parseList, linkedList, replaceList, findLists, linkPayload } from '../src/tree.js';

export const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
export const item = (text, children) => ({ type: 'listItem', content: [paragraph(text), ...(children ? [children] : [])] });
export const list = (...items) => ({ type: 'bulletList', content: items });
export const example = list(item('A'), item('B', list(item('C', list(item('D'), item('E'))), item('F'))), item('G'));

test('the supplied A–G list preserves every immediate parent and sibling order', () => {
  assert.deepEqual(parseList(example), [
    { summary: 'A', parent: null, depth: 0 },
    { summary: 'B', parent: null, depth: 0 },
    { summary: 'C', parent: 1, depth: 1 },
    { summary: 'D', parent: 2, depth: 2 },
    { summary: 'E', parent: 2, depth: 2 },
    { summary: 'F', parent: 1, depth: 1 },
    { summary: 'G', parent: null, depth: 0 },
  ]);
});

test('replacement preserves surrounding rich text and rejects changes to the selected list', () => {
  const document = { type: 'doc', version: 1, content: [paragraph('Before'), example, paragraph('After')] };
  const nodes = parseList(example).map((node, index) => ({ ...node, key: `TEST-${index + 1}` }));
  const replacement = linkedList(nodes, 'https://example.atlassian.net');
  const changed = replaceList(document, 1, example, replacement);
  assert.deepEqual(changed.content[0], document.content[0]);
  assert.deepEqual(changed.content[2], document.content[2]);
  assert.deepEqual(document.content[1], example);
  assert.equal(changed.content[1].content[1].content[1].content[0].content[1].content.length, 2);
  const cards = [];
  const collect = (node) => {
    if (node.type === 'inlineCard') cards.push(node);
    for (const child of node.content || []) collect(child);
  };
  collect(changed.content[1]);
  assert.deepEqual(cards, nodes.map((node) => ({ type: 'inlineCard', attrs: { url: `https://example.atlassian.net/browse/${node.key}` } })));
  assert.equal(replaceList(changed, 1, example, replacement), changed);
  assert.throws(() => replaceList({ ...document, content: [paragraph('changed')] }, 1, example, replacement), /source list changed/);
  assert.match(findLists(changed)[0].error, /already contains ticket links/);
});

test('invalid, empty, oversized and unsupported list content is rejected before writing', () => {
  assert.throws(() => parseList(list()), /empty/);
  assert.throws(() => parseList(list(item('   '))), /title/);
  assert.throws(() => parseList(list(item('a'.repeat(256)))), /255/);
  assert.throws(() => parseList(list(...Array.from({ length: 101 }, () => item('Task')))), /100/);
  assert.throws(() => parseList(list({ type: 'listItem', content: [{ type: 'codeBlock' }] })), /Unsupported/);
});

test('storage key reordering does not look like a concurrent description edit', () => {
  const reordered = JSON.parse(JSON.stringify(example), (_, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).reverse());
  });
  const document = { type: 'doc', version: 1, content: [example] };
  const replacement = linkedList(parseList(example).map((node, index) => ({ ...node, key: `TEST-${index}` })), 'https://example.atlassian.net');
  assert.deepEqual(replaceList(document, 0, reordered, replacement).content[0], replacement);
});

test('link directions give parents has subtask and children is subtask of, including reversed configuration', () => {
  const usual = { id: '1', inward: 'is subtask of', outward: 'has subtask' };
  assert.deepEqual(linkPayload(usual, 'P-1', 'P-2'), { type: { id: '1' }, inwardIssue: { key: 'P-1' }, outwardIssue: { key: 'P-2' } });
  assert.deepEqual(linkPayload({ ...usual, inward: usual.outward, outward: usual.inward }, 'P-1', 'P-2'), { type: { id: '1' }, inwardIssue: { key: 'P-2' }, outwardIssue: { key: 'P-1' } });
});
