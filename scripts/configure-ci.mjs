import { readFileSync, writeFileSync } from 'node:fs';
const { FORGE_EMAIL, FORGE_API_TOKEN, FORGE_APP_ID, ATLASSIAN_SITE } = process.env;
for (const [key, value] of Object.entries({ FORGE_EMAIL, FORGE_API_TOKEN, FORGE_APP_ID, ATLASSIAN_SITE })) {
  if (!value) throw new Error(`Configure ${key} in the GitHub production environment. See README.`);
}
if (!/^ari:cloud:ecosystem::app\/[0-9a-f-]{36}$/i.test(FORGE_APP_ID)) throw new Error('FORGE_APP_ID must be the complete registered Forge app ARI.');
if (!/^[a-z0-9-]+\.atlassian\.net$/i.test(ATLASSIAN_SITE)) throw new Error('ATLASSIAN_SITE must be a hostname such as example.atlassian.net, without https://.');
const manifest = readFileSync('manifest.yml', 'utf8').replace(/ {2}id: ari:cloud:ecosystem::app\/[^\n]+/, `  id: ${FORGE_APP_ID}`);
writeFileSync('manifest.yml', manifest);
