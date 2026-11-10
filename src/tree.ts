import type { AdfDocument, AdfNode, LinkPayload, LinkType, ListChoice, TaskNode } from './types';
import { errorMessage } from './errors';

// Pure ADF transformations. The description stays in Jira's native rich-text format.
const MAX_NESTED_DEPTH = 20;
const MAX_ITEMS = 100;
const MAX_SUMMARY_LENGTH = 255;

// KVS/Jira may return object properties in a different order. Arrays retain their
// meaningful order, while object-key order must not look like a description edit.
export const fingerprint = (value: unknown): string => JSON.stringify(value, (_, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
});

const textOf = (node: AdfNode): string => {
  if (node.marks?.some((mark) => mark.type === 'link' && /\/browse\//.test(mark.attrs?.href || ''))) throw new Error('This list already contains ticket links.');
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return ' ';
  if (node.type === 'mention') return node.attrs?.text || '';
  if (node.type === 'emoji') return node.attrs?.text || node.attrs?.shortName || '';
  if (node.type === 'inlineCard') throw new Error('This list already contains ticket links.');
  if (!['paragraph', 'listItem', 'taskItem', 'blockTaskItem'].includes(node.type)) throw new Error(`Unsupported list content: ${node.type}. Use text and nested action or bullet lists.`);
  return (node.content || []).map(textOf).join('');
};

const isList = (node: AdfNode): boolean => ['bulletList', 'taskList'].includes(node.type);

export function parseList(list: AdfNode): TaskNode[] {
  const nodes: TaskNode[] = [];
  function visit(current: AdfNode, parent: number | null, depth: number): void {
    if (!isList(current)) throw new Error('Use a Jira action list or bulleted list.');
    if (depth > MAX_NESTED_DEPTH) throw new Error(`The maximum nesting depth is ${MAX_NESTED_DEPTH}.`);
    if (!current.content?.length) throw new Error('This list is empty.');
    let previous: number | null = null;
    for (const item of current.content || []) {
      // ADF action lists nest beside the preceding taskItem, not inside it.
      if (current.type === 'taskList' && item.type === 'taskList') {
        if (previous === null) throw new Error('A nested action list must follow an action item.');
        visit(item, previous, depth + 1);
        continue;
      }
      const validItem = current.type === 'taskList' ? ['taskItem', 'blockTaskItem'].includes(item.type) : item.type === 'listItem';
      if (!validItem) throw new Error('Invalid list item.');
      const blocks = item.content || [];
      const paragraphs = blocks.filter((block) => !isList(block));
      const summary = paragraphs.map(textOf).join(item.type === 'taskItem' ? '' : ' ').trim();
      if (!summary || summary.length > MAX_SUMMARY_LENGTH) {
        throw new Error(`Each item needs a title of 1–${MAX_SUMMARY_LENGTH} characters.`);
      }
      const index = nodes.length;
      const node: TaskNode = { summary, parent, depth };
      if (current.type === 'taskList') {
        const state = item.attrs?.state;
        if (state !== 'TODO' && state !== 'DONE') throw new Error('An action item must have a valid checkbox state.');
        node.actionState = state;
      }
      nodes.push(node);
      previous = index;
      if (nodes.length > MAX_ITEMS) throw new Error(`Convert at most ${MAX_ITEMS} items at a time.`);
      for (const child of blocks.filter(isList)) visit(child, index, depth + 1);
    }
  }
  visit(list, null, 0);
  if (!nodes.length) throw new Error('This list is empty.');
  return nodes;
}

export function findLists(description: AdfDocument | null): ListChoice[] {
  // Only top-level lists are selectable: nested lists belong to their enclosing tree.
  return (description?.content || []).flatMap<ListChoice>((block, index) => {
    if (!isList(block)) return [];
    try {
      const nodes = parseList(block);
      return [{ index, nodes, label: `${nodes[0].summary} (${nodes.length} ${block.type === 'taskList' ? 'actions' : 'tasks'})` }];
    } catch (error) {
      return [{ index, error: errorMessage(error), label: `List ${index + 1}` }];
    }
  });
}

export function linkedList(nodes: TaskNode[], baseUrl: string, { createdOnly = false }: { createdOnly?: boolean } = {}): AdfNode {
  const build = (parent: number | null): AdfNode => ({
    type: 'bulletList',
    content: nodes.flatMap((node, index) => {
      if (node.parent !== parent) return [];
      if (!node.key) {
        if (createdOnly) return [];
        throw new Error('Every task must be created before replacing the list.');
      }
      const content: AdfNode[] = [{ type: 'paragraph', content: [
        { type: 'inlineCard', attrs: { url: `${baseUrl}/browse/${node.key}` } },
      ] }];
      if (nodes.some((child) => child.parent === index && (!createdOnly || child.key))) content.push(build(index));
      return [{ type: 'listItem', content }];
    }),
  });
  return build(null);
}

export function replaceList(description: AdfDocument | null, index: number, original: AdfNode, replacement: AdfNode): AdfDocument {
  if (!description) throw new Error('The source list changed. Restore the original list before resuming; created tickets are preserved.');
  if (fingerprint(description.content[index]) === fingerprint(replacement)) return description;
  if (fingerprint(description?.content?.[index]) !== fingerprint(original)) {
    throw new Error('The source list changed. Restore the original list before resuming; created tickets are preserved.');
  }
  const result = structuredClone(description);
  result.content[index] = replacement;
  return result;
}

export function linkPayload(type: LinkType, parent: string, child: string): LinkPayload {
  // Jira displays the outward label on inwardIssue, pointing to outwardIssue.
  const parentIsInward = type.outward.toLowerCase() === 'has subtask';
  return { type: { id: type.id }, inwardIssue: { key: parentIsInward ? parent : child }, outwardIssue: { key: parentIsInward ? child : parent } };
}
