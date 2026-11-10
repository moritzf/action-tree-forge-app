import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Link, ProgressBar, SectionMessage, Select, Spinner, Stack, Text, Textfield } from '@forge/react';
import { invoke, view } from '@forge/bridge';

async function call(name, payload) {
  const result = await invoke(name, payload);
  if (result.error) throw new Error(result.error);
  return result.data;
}

function App() {
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(null);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  useEffect(() => {
    call('inspect').then((data) => {
      setPreview(data);
      setRun(data.run);
      setSelected(data.lists.find((list) => !list.error) || null);
    }).catch((failure) => setError(failure.message));
  }, []);

  async function convert() {
    setBusy(true);
    setError('');
    try {
      let current = run && !run.done ? run : await call('begin', { index: selected.index, hash: selected.hash });
      setRun(current);
      while (!current.done) {
        current = await call('step');
        setRun(current);
      }
    } catch (failure) {
      setError(failure.message);
      // Reload persisted progress if the browser lost a response after a successful write.
      try { setRun((await call('inspect')).run); } catch { /* Keep the original error visible. */ }
    } finally { setBusy(false); }
  }

  const nodes = run && !run.done ? run.nodes : selected?.nodes;
  const complete = run?.nodes.filter((node) => node.linked).length || 0;
  return <Stack space="space.200">
    <Heading as="h2">Action Tree</Heading>
    {error && <SectionMessage appearance="error" title="Conversion paused"><Text>{error}</Text></SectionMessage>}
    {error.includes('uncertain') && <>
      <Text>If the Task was created, enter its issue key to recover it. Action Tree verifies its origin before using it.</Text>
      <Textfield label="Created Task key" value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} />
      <Button isDisabled={busy || !recoveryKey.trim()} onClick={async () => {
        setBusy(true);
        try {
          setRun(await call('recover', { key: recoveryKey.trim() }));
          setError('');
        } catch (failure) { setError(`Creation outcome is uncertain. ${failure.message}`); }
        finally { setBusy(false); }
      }}>Recover created Task</Button>
    </>}
    {!preview && !error && <Spinner label="Reading issue description" />}
    {preview && <>
      <Text>Create Tasks from a nested bullet list in {preview.key}. Each root links to this issue; each nested task links to its immediate parent using “is subtask of” / “has subtask”.</Text>
      {(!run || run.done) && !run?.done && <>
        <Select label="Description list" options={preview.lists.map((list) => ({ label: list.error ? `${list.label}: ${list.error}` : list.label, value: list.index, isDisabled: !!list.error }))}
          value={selected ? { label: selected.label, value: selected.index } : null}
          onChange={(option) => setSelected(preview.lists.find((list) => list.index === option?.value) || null)} />
        {!preview.lists.length && <Text>Add a bulleted list to the issue description, then reopen Action Tree.</Text>}
      </>}
      {!run?.done && nodes?.map((node, index) => <Text key={index}>{`${'　'.repeat(node.depth)}• ${node.summary}`}</Text>)}
      {run && <>
        <ProgressBar value={run.done ? 1 : complete / (run.nodes.length + 1)} />
        <Text>{run.done ? 'Done. The description now contains the nested issue card list.' : `${complete} of ${run.nodes.length} Tasks created and linked. Keep this window open while converting.`}</Text>
        {run.nodes.filter((node) => node.key).map((node) => <Text key={node.key}><Link href={`${run.baseUrl}/browse/${node.key}`}>{node.key}</Link>{` — ${node.summary}`}</Text>)}
      </>}
      {run?.done && preview.lists.some((list) => !list.error) && <Button onClick={() => setRun(null)}>Convert another list</Button>}
      {!run?.done && <Text>The selected list will become a nested bulleted list of rich Jira issue cards. Other description content is preserved. Up to 100 Tasks per conversion.</Text>}
      {!run?.done && <Button appearance="primary" isLoading={busy} isDisabled={busy || (!selected && !run)} onClick={convert}>{run ? 'Resume conversion' : `Create ${selected?.nodes?.length || ''} Tasks`}</Button>}
    </>}
    <Button isDisabled={busy} onClick={() => view.close()}>Close</Button>
  </Stack>;
}

ForgeReconciler.render(<App />);
