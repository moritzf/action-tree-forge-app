# Action Tree

An Atlassian Forge app that turns a native Jira checkbox action list or nested bullet list in a Jira Task's description into a tree of linked Tasks. Built with Forge UI Kit (`@forge/react`), Jira REST API v3 and Forge Key-Value Store. All application processing and conversion state stay on Atlassian; there is no external backend.

## Usage

1. Open a **Task** with a native checkbox action list or bulleted list in its description.
2. In the issue's right sidebar, expand **Action Tree** below the issue fields and click **Convert with Action Tree**, then select the list and review the preview. Jira controls the sidebar panel order; place Action Tree below Automation using Jira's panel ordering controls if needed.
3. Click **Create Tasks** and keep the modal open until conversion finishes.
4. The selected list becomes a nested bulleted list of rich Jira issue cards (ADF `inlineCard` nodes), with issue details resolved by Jira. Refresh the issue if necessary.

The Action Tree popup also displays created Tasks as nested rich issue cards, both during conversion and after completion.

For this input:

```text
- A
- B
  - C
    - D
    - E
  - F
- G
```

Action Tree creates seven **Task** issues in the source issue's project. A, B and G link to the source Task; C and F link to B; D and E link to C. Each child **is subtask of** its immediate parent, and each parent **has subtask** its children. These are reciprocal views of one Jira issue link per relationship. They are not Jira's built-in Sub-task issue type or `parent` field, so the link-based tree can nest beyond Jira's native subtask hierarchy. No transitive links are added between grandchildren and grandparents.

Other description blocks stay intact. Use native Jira editor checkbox action lists (`taskList` / `taskItem`, including paragraph-based `blockTaskItem`) or bullet lists, not plain text containing checkbox symbols or hyphens. Nested action lists follow the preceding action item in ADF; their parent relationships are preserved. Both list types become nested bulleted lists of rich issue cards.

Checked and unchecked actions are included. The preview shows their checkbox state, and the original `TODO` / `DONE` state is recorded in each created Task's `action-tree.origin` property. Created Tasks use the project's default workflow status; checking an action does not select or transition a Jira workflow status automatically. Up to 100 items and 20 nesting levels per conversion. Titles must be 1–255 characters. Unsupported blocks, empty items and lists already containing Jira ticket links are rejected. Created Tasks receive titles and the project/issue type; other fields use Jira's configured defaults. Extra required fields without defaults block conversion before the first creation.

## Site prerequisites

- A project with the **Task** issue type and issue linking enabled.
- Jira permissions: Browse Projects, Create Issues, Edit Issues and Link Issues.
- A Jira administrator must configure one issue link type, for example **Action Tree**, with inward description **is subtask of** and outward description **has subtask**. Existing link types are reused if those descriptions match, including reversed inward/outward configuration. The app never changes global Jira administration settings.
- Users consent to the app's declared Jira scopes. Backend Jira requests use `asUser()`, so the signed-in user's permissions are enforced on every conversion invocation.

## Local development

```sh
npm ci
npm run check
npm run forge -- login
npm run forge -- register 'Action Tree'
npm run forge -- lint
npm run forge -- deploy --environment development
npm run forge -- install --site YOUR-SITE.atlassian.net --product jira --environment development
npm run forge -- tunnel
```

Forge registration may ask you to select a Developer Space and accept Atlassian's terms. Registration replaces the placeholder `app.id` in `manifest.yml` with your real app ID. Do not register again for routine deployments: it creates a different app identity. Use the same identity for development and production environments.

Node 24 is required. `.nvmrc` and GitHub Actions select Node 24. A local Node runtime is also installed as a development dependency, so `npm run forge -- …` uses the supported version even when your shell runs another Node version. Avoid bare `npx forge` with an unsupported system Node.

## GitHub CI/CD

Pull requests and pushes to `main` run ESLint and the Node test suite. A successful main-branch push triggers the production deployment workflow. Manual dispatch also runs the checks before deploying. Deployment targets the private site configured in the **GitHub environment `production`**, and deployments are serialized. Fork pull requests never receive deployment credentials.

The workflow runs `forge lint --environment production` before deployment. Normal changes deploy automatically. If Forge reports `MAJOR_VERSION_RULE` (including permission changes that cause a major app version), the workflow validates that there are no other lint failures, then pauses at an approval-only job using the **`permission-upgrade` GitHub environment**. Configure that environment with `moritzf` as a required reviewer. Permit self-review so the repository owner can approve their own changes. Only after the review succeeds does deployment use `--approve MAJOR_VERSION_RULE` and upgrade the site installation. Rejecting the review or any other lint error blocks deployment.

The environment name itself does not enforce review: its required-reviewer protection rule does. `permission-upgrade` needs no secrets or variables; deployment credentials remain in `production`. Approve pending upgrades through **Actions → workflow run → Review deployments** after reviewing the lint output.

In **Settings → Environments → production**, configure:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `FORGE_EMAIL` | Email of the Forge app owner or contributor |
| Secret | `FORGE_API_TOKEN` | That user's Atlassian API scoped token for Forge CLI |
| Variable | `ATLASSIAN_SITE` | Your private site's hostname, e.g. `example.atlassian.net` (no `https://`) |
| Variable | `FORGE_APP_ID` | Complete `ari:cloud:ecosystem::app/…` from `manifest.yml` after registration |

Create the token using the [current Forge login instructions](https://developer.atlassian.com/platform/forge/getting-started/#log-in-with-an-atlassian-api-scoped-token); use the Forge scopes specified there. Do not put the token in the repository or pass it in a chat. CI authenticates through `FORGE_EMAIL` and `FORGE_API_TOKEN`, as described in [Atlassian's continuous-delivery guide](https://developer.atlassian.com/platform/forge/set-up-cicd/). The token must belong to an account that can deploy the app and install it on the target site.

After registration and setting the variables/secrets:

1. Open **Actions → Deploy to private Jira site → Run workflow**.
2. Choose `installation: install` for the first production deployment.
3. Future successful main pushes deploy and **upgrade** the existing installation. If installation or scope approval fails, the workflow fails visibly; it does not silently ignore the error.

An initial push before credentials are configured will pass CI and fail deployment at the configuration check. Re-run manually after configuration. `FORGE_APP_ID` is injected into the manifest only inside CI; the site's hostname is never hardcoded in application code or workflow source.

## Architecture and verification

| File | Responsibility |
| --- | --- |
| `src/frontend/index.jsx` | Issue sidebar button and native UI Kit modal |
| `src/frontend/converter.jsx` | Preview, confirmation, progress and resume |
| `src/index.js` | Resolver boundary, trusted issue context, per-issue conversion lease |
| `src/conversion.js` | Durable conversion state machine, create claims and recovery boundaries |
| `src/jira.js` | User-authorized Jira REST calls, field/permission preflight and link operations |
| `src/tree.js` | Pure ADF parsing, parent mapping and description replacement |

Each resolver call creates and links at most one Task to avoid a single long-running invocation. Progress is saved after creation and after linking. An atomic KVS lease prevents overlapping operations on one source issue. Persistent creation claims prevent automatic duplicate creation if a network failure leaves the outcome uncertain. Jira issues include an `action-tree.origin` entity property with the source issue, conversion ID and item index for reconciliation. Conversion state is scoped to the Forge installation and source issue; unfinished conversions resume before another list can be processed.

Tests cover the A–G hierarchy, link direction, title/size validation, preservation of surrounding ADF, stale preview rejection, non-Task rejection, partial link failure, uncertain creation, definitive Jira errors and resuming a completed conversion. Run `npm run check`; `npm run forge -- lint` additionally validates the manifest and scopes and requires Forge login.

## Failure recovery and limits

If a link or final description update fails, reopen Action Tree and choose **Resume conversion**. Created Tasks are retained and reused. The app does not delete issues to roll back partial work. After a browser interruption, a conversion lease may take up to one minute to expire.

If task creation has an **uncertain outcome**, automatic retry stops. Find the recently created Task and enter its key under **Recover created Task** in the modal. The backend checks that its project, Task type and `action-tree.origin` property exactly match the paused conversion before saving it; then choose **Resume conversion**. If the Task definitely does not exist, an app administrator must reconcile the persistent claim before another create attempt. Inspect the KVS run at `action-tree:<source issue ID>` and its matching `create:<source issue ID>:<run ID>:<index>` claim using an administrator-controlled recovery resolver. Clear only the verified failed creation claim; keep the run and other claims intact. Never clear claims until Jira's creation outcome is verified. The app deliberately provides no blind retry button for an ambiguous creation.

If the selected list changed, restore that list's original content before resuming. Changes elsewhere in the description made before the final fetch are preserved. Jira's description update API does not offer an atomic compare-and-swap operation; a simultaneous edit between the final fetch and write can still race. Coordinate edits to the source description during conversion.

Conversion state and create claims are retained for recovery. Uninstalling the app follows Atlassian's Forge storage retention policy; created Jira issues and links remain Jira data. Global issue link types are configured separately and remain on the site.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE), as requested. See [NOTICE](NOTICE). This is source-available software; commercial licensing is not granted by this license. Third-party dependencies retain their own licenses.
