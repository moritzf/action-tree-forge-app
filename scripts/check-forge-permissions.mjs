import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkForgePermissions(runLint) {
  const initial = runLint([]);
  if (initial.error || initial.status === null) throw new Error('Forge lint could not run.');
  const major = /\bMAJOR_VERSION_RULE\b/.test(`${initial.stdout || ''}\n${initial.stderr || ''}`);
  if (major) {
    // This acknowledges only the lint diagnostic, never a deployment. Other
    // errors and approval rules must still block the workflow before review.
    const checked = runLint(['--approve', 'MAJOR_VERSION_RULE']);
    if (checked.error || checked.status !== 0) throw new Error('Forge lint found additional problems; deployment is blocked.');
  } else if (initial.status !== 0) {
    throw new Error(`Forge lint failed (${initial.status}); deployment is blocked.`);
  }
  return major;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const major = checkForgePermissions((extra) => {
    const result = spawnSync('node_modules/.bin/forge', ['lint', '--environment', 'production', ...extra], { encoding: 'utf8' });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    return result;
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error('Run this script inside GitHub Actions.');
  appendFileSync(process.env.GITHUB_OUTPUT, `major=${major}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, major
      ? '### Human approval required\nForge detected a major app version change. Review the lint output before approving the permission-upgrade environment.\n'
      : '### No permission approval required\nForge checks passed; the normal deployment can proceed automatically.\n');
  }
}
