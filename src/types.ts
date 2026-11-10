// Model the Jira fields this app consumes; keep other ADF attributes intact.
export interface AdfNode {
  type: string;
  text?: string;
  version?: number;
  attrs?: {
    state?: string;
    text?: string;
    shortName?: string;
    url?: string;
    [key: string]: unknown;
  };
  marks?: { type: string; attrs?: { href?: string; [key: string]: unknown } }[];
  content?: AdfNode[];
}

export interface AdfDocument extends AdfNode {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

export interface TaskNode {
  summary: string;
  parent: number | null;
  depth: number;
  actionState?: 'TODO' | 'DONE';
  key?: string;
  linked?: boolean;
}

export type ListChoice = { index: number; label: string } & (
  | { nodes: TaskNode[]; error?: never }
  | { error: string; nodes?: never }
);

export interface LinkType {
  id: string;
  inward: string;
  outward: string;
}

export interface LinkPayload {
  type: { id: string };
  inwardIssue: { key: string };
  outwardIssue: { key: string };
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    description: AdfDocument | null;
    project: { id: string };
    issuetype: { id: string; name: string; subtask: boolean };
    issuelinks?: { type: { id: string }; outwardIssue?: { key: string } }[];
  };
}

export interface ConversionSetup {
  projectId: string;
  taskTypeId: string;
  linkType: LinkType;
  baseUrl: string;
}

export interface ConversionRun extends ConversionSetup {
  id: string;
  index: number;
  original: AdfNode;
  nodes: TaskNode[];
  sourceKey: string;
  done: boolean;
}

export interface TaskOrigin {
  source: string;
  run: string;
  index: number;
  actionState?: TaskNode['actionState'];
}

export interface JiraClient {
  getIssue(id: string): Promise<JiraIssue>;
  getOrigin(id: string): Promise<TaskOrigin>;
  preflight(issue: JiraIssue): Promise<ConversionSetup>;
  createTask(projectId: string, typeId: string, summary: string, marker: TaskOrigin): Promise<{ key: string }>;
  ensureLink(body: LinkPayload): Promise<void>;
  updateDescription(id: string, description: AdfDocument): Promise<void>;
}

export interface ConversionStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  claim(key: string, value: { summary: string; sourceKey: string }): Promise<void>;
}
