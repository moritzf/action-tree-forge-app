import { createHash } from 'node:crypto';
import { findLists, fingerprint, linkedList, replaceList, linkPayload } from './tree.js';

export const digest = (value) => createHash('sha256').update(fingerprint(value)).digest('hex');

// Inject Jira and storage so failure/recovery behavior can be tested without a site.
export function conversionService({ jira, store }) {
  const stateKey = (issueId) => `action-tree:${issueId}`;
  async function source(issueId) {
    const issue = await jira.getIssue(issueId);
    if (issue.fields.issuetype.name.toLowerCase() !== 'task' || issue.fields.issuetype.subtask) {
      throw new Error('Action Tree works on Task issues only.');
    }
    return issue;
  }
  async function inspect(issueId) {
    const issue = await source(issueId);
    return { key: issue.key, lists: findLists(issue.fields.description).map((list) => ({ ...list, hash: digest(issue.fields.description.content[list.index]) })), run: await store.get(stateKey(issueId)) };
  }
  async function begin(issueId, index, expected) {
    const existing = await store.get(stateKey(issueId));
    if (existing && !existing.done) return existing;
    const issue = await source(issueId);
    const list = findLists(issue.fields.description).find((entry) => entry.index === index);
    if (!list || list.error) throw new Error(list?.error || 'Choose a bulleted list from the description.');
    const original = issue.fields.description.content[index];
    if (digest(original) !== expected) throw new Error('The list changed. Close and reopen Action Tree to preview it again.');
    const setup = await jira.preflight(issue);
    const run = { id: digest([issue.id, index, original]), index, original, nodes: list.nodes, sourceKey: issue.key, ...setup, done: false };
    if (Buffer.byteLength(JSON.stringify(run)) > 180000) throw new Error('This list is too large. Split it into smaller lists.');
    await store.set(stateKey(issueId), run);
    return run;
  }
  async function step(issueId) {
    await source(issueId); // Authorize every invocation, including resumed conversions.
    const run = await store.get(stateKey(issueId));
    if (!run) throw new Error('Preview a list before converting.');
    if (run.done) return run;
    const save = () => store.set(stateKey(issueId), run);
    const index = run.nodes.findIndex((node) => !node.linked);
    if (index !== -1) {
      const node = run.nodes[index];
      if (!node.key) {
        const claim = `create:${issueId}:${run.id}:${index}`;
        // A persistent claim stops a network timeout from creating duplicate tasks on retry.
        // Only a definitive Jira rejection permits another create attempt.
        if (await store.get(claim)) throw new Error(`Creation outcome for “${node.summary}” is uncertain. An administrator must reconcile the create claim before retrying. See README recovery instructions.`);
        await store.claim(claim, { summary: node.summary, sourceKey: run.sourceKey });
        try {
          const created = await jira.createTask(run.projectId, run.taskTypeId, node.summary, { source: run.sourceKey, run: run.id, index });
          node.key = created.key;
          await save();
        } catch (error) {
          if (error.definitive) await store.delete(claim);
          throw error;
        }
      }
      const parent = node.parent === null ? run.sourceKey : run.nodes[node.parent].key;
      await jira.ensureLink(linkPayload(run.linkType, parent, node.key));
      node.linked = true;
      await save();
      return run;
    }
    const current = await source(issueId);
    const replacement = linkedList(run.nodes, run.baseUrl);
    const description = replaceList(current.fields.description, run.index, run.original, replacement);
    if (fingerprint(description) !== fingerprint(current.fields.description)) {
      await jira.updateDescription(issueId, description);
    }
    run.done = true;
    await save();
    return run;
  }
  async function recover(issueId, key) {
    await source(issueId);
    const run = await store.get(stateKey(issueId));
    if (!run || run.done) throw new Error('No conversion needs recovery.');
    const index = run.nodes.findIndex((node) => !node.linked);
    if (index === -1 || run.nodes[index].key) throw new Error('Resume conversion to retry linking or the description update.');
    if (!/^[A-Z][A-Z0-9_]*-\d+$/i.test(key || '')) throw new Error('Enter an existing Jira issue key.');
    const candidate = await jira.getIssue(key);
    const origin = await jira.getOrigin(key);
    if (candidate.fields.project.id !== run.projectId || candidate.fields.issuetype.id !== run.taskTypeId ||
      origin.source !== run.sourceKey || origin.run !== run.id || origin.index !== index) {
      throw new Error('This Task was not created for the paused list item.');
    }
    run.nodes[index].key = candidate.key;
    await store.set(stateKey(issueId), run);
    return run;
  }
  return { inspect, begin, step, recover };
}
