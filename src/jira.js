import { asUser, route } from '@forge/api';

async function request(path, method = 'GET', body) {
  const response = await asUser().requestJira(path, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = new Error(`Jira rejected ${method} (${response.status}). ${await response.text()}`);
    // 5xx responses may happen after a write; never blindly retry a task creation.
    error.definitive = response.status >= 400 && response.status < 500;
    throw error;
  }
  // Issue-link creation returns 201 with no body; issue updates return 204.
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

export const jira = {
  getOrigin: async (id) => (await request(route`/rest/api/3/issue/${id}/properties/action-tree.origin`)).value,
  getIssue: (id) => request(route`/rest/api/3/issue/${id}?fields=description,issuetype,project,issuelinks`),
  async preflight(issue) {
    const projectId = issue.fields.project.id;
    // Use the source Task type ID: projects may have different Task IDs.
    const taskTypeId = issue.fields.issuetype.id;
    const permission = await request(route`/rest/api/3/mypermissions?issueKey=${issue.key}&permissions=BROWSE_PROJECTS,CREATE_ISSUES,EDIT_ISSUES,LINK_ISSUES`);
    const missing = Object.entries(permission.permissions).filter(([, value]) => !value.havePermission).map(([key]) => key);
    if (missing.length) throw new Error(`Missing Jira permissions: ${missing.join(', ')}`);
    const linkTypes = (await request(route`/rest/api/3/issueLinkType`)).issueLinkTypes;
    const linkType = linkTypes.find((type) => [type.inward.toLowerCase(), type.outward.toLowerCase()].sort().join('|') === ['has subtask', 'is subtask of'].join('|'));
    if (!linkType) throw new Error('Ask a Jira administrator to add an issue link type with inward “is subtask of” and outward “has subtask”.');
    const fields = [];
    let startAt = 0;
    while (true) {
      const page = await request(route`/rest/api/3/issue/createmeta/${projectId}/issuetypes/${taskTypeId}?startAt=${startAt}&maxResults=100`);
      const values = page.fields || page.values || [];
      fields.push(...values);
      startAt += values.length;
      if (page.isLast || startAt >= page.total || !values.length) break;
    }
    if (!fields.some((field) => field.fieldId === 'summary')) throw new Error('Task creation is unavailable in this project.');
    const required = fields.filter((field) => field.required && !field.hasDefaultValue && !['summary', 'project', 'issuetype'].includes(field.fieldId));
    if (required.length) throw new Error(`Configure defaults for required Task fields before converting: ${required.map((field) => field.name).join(', ')}.`);
    const server = await request(route`/rest/api/3/serverInfo`);
    return { projectId, taskTypeId, linkType, baseUrl: server.baseUrl.replace(/\/$/, '') };
  },
  createTask: (projectId, typeId, summary, marker) => request(route`/rest/api/3/issue`, 'POST', {
    fields: { project: { id: projectId }, issuetype: { id: typeId }, summary },
    properties: [{ key: 'action-tree.origin', value: marker }],
  }),
  async ensureLink(body) {
    // Jira's link creation is idempotent for an existing link, but avoid the write when possible.
    const issue = await jira.getIssue(body.inwardIssue.key);
    if (issue.fields.issuelinks?.some((link) => link.type.id === body.type.id && link.outwardIssue?.key === body.outwardIssue.key)) return;
    await request(route`/rest/api/3/issueLink`, 'POST', body);
  },
  updateDescription: (id, description) => request(route`/rest/api/3/issue/${id}`, 'PUT', { fields: { description } }),
};
