// Pure ADF transformations. The description stays in Jira's native rich-text format.
// KVS/Jira may return object properties in a different order. Arrays retain their
// meaningful order, while object-key order must not look like a description edit.
export const fingerprint = (value) => JSON.stringify(value, (_, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
});

const textOf = (node) => {
  if (node.type === 'text') return node.text;
  if (node.type === 'hardBreak') return ' ';
  if (node.type === 'mention') return node.attrs?.text || '';
  if (node.type === 'emoji') return node.attrs?.text || node.attrs?.shortName || '';
  if (node.type === 'inlineCard') throw new Error('This list already contains ticket links.');
  if (!['paragraph', 'listItem'].includes(node.type)) throw new Error(`Unsupported list content: ${node.type}. Use text and nested bullet lists.`);
  return (node.content || []).map(textOf).join('');
};

export function parseList(list) {
  const nodes = [];
  function visit(current, parent, depth) {
    if (current.type !== 'bulletList') throw new Error('Use a bulleted list.');
    if (depth > 20) throw new Error('The maximum nesting depth is 20.');
    for (const item of current.content || []) {
      if (item.type !== 'listItem') throw new Error('Invalid list item.');
      const blocks = item.content || [];
      const paragraphs = blocks.filter((block) => block.type !== 'bulletList');
      const summary = paragraphs.map(textOf).join(' ').trim();
      if (!summary || summary.length > 255) throw new Error('Each item needs a title of 1–255 characters.');
      if (paragraphs.some((p) => p.content?.some((n) => n.marks?.some((m) => m.type === 'link' && /\/browse\//.test(m.attrs?.href))))) {
        throw new Error('This list already contains ticket links.');
      }
      const index = nodes.length;
      nodes.push({ summary, parent, depth });
      if (nodes.length > 100) throw new Error('Convert at most 100 items at a time.');
      for (const child of blocks.filter((block) => block.type === 'bulletList')) visit(child, index, depth + 1);
    }
  }
  visit(list, null, 0);
  if (!nodes.length) throw new Error('This list is empty.');
  return nodes;
}

export function findLists(description) {
  // Only top-level lists are selectable: nested lists belong to their enclosing tree.
  return (description?.content || []).flatMap((block, index) => {
    if (block.type !== 'bulletList') return [];
    try {
      const nodes = parseList(block);
      return [{ index, nodes, label: `${nodes[0].summary} (${nodes.length} tasks)` }];
    } catch (error) {
      return [{ index, error: error.message, label: `List ${index + 1}` }];
    }
  });
}

export function linkedList(nodes, baseUrl) {
  const build = (parent) => ({
    type: 'bulletList',
    content: nodes.flatMap((node, index) => {
      if (node.parent !== parent) return [];
      if (!node.key) throw new Error('Every task must be created before replacing the list.');
      const content = [{ type: 'paragraph', content: [
        { type: 'text', text: node.key, marks: [{ type: 'link', attrs: { href: `${baseUrl}/browse/${node.key}` } }] },
        { type: 'text', text: ` — ${node.summary}` },
      ] }];
      if (nodes.some((child) => child.parent === index)) content.push(build(index));
      return [{ type: 'listItem', content }];
    }),
  });
  return build(null);
}

export function replaceList(description, index, original, replacement) {
  if (fingerprint(description?.content?.[index]) === fingerprint(replacement)) return description;
  if (fingerprint(description?.content?.[index]) !== fingerprint(original)) {
    throw new Error('The source list changed. Restore the original list before resuming; created tickets are preserved.');
  }
  const result = structuredClone(description);
  result.content[index] = replacement;
  return result;
}

export function linkPayload(type, parent, child) {
  // Jira displays the outward label on inwardIssue, pointing to outwardIssue.
  const parentIsInward = type.outward.toLowerCase() === 'has subtask';
  return { type: { id: type.id }, inwardIssue: { key: parentIsInward ? parent : child }, outwardIssue: { key: parentIsInward ? child : parent } };
}
