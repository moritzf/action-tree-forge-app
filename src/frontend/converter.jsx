import React, { useEffect, useState } from 'react';
import { AdfRenderer, Button, Heading, Inline, ProgressBar, SectionMessage, Select, Spinner, Stack, Text, Textfield } from '@forge/react';
import { invoke } from '@forge/bridge';
import { linkedList } from '../tree.js';

async function call(name, payload) {
  const result = await invoke(name, payload);
  if (result.error) throw new Error(result.error);
  return result.data;
}

export default function Converter({ onBusyChange }) {
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(null);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
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
    <Heading as="h2" size="medium">Convert List to Sub-Issues</Heading>
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
      {!run?.done && <SectionMessage appearance="information" title="How it works">
        <Text>Each item becomes a Task linked to its parent. The list is replaced with rich issue cards; other text stays unchanged.</Text>
      </SectionMessage>}
      {!run && <>
        <Select label={`List from ${preview.key}`} options={preview.lists.map((list) => ({ label: list.error ? `${list.label}: ${list.error}` : list.label, value: list.index, isDisabled: !!list.error }))}
          value={selected ? { label: selected.label, value: selected.index } : null}
          onChange={(option) => setSelected(preview.lists.find((list) => list.index === option?.value) || null)} />
        {!preview.lists.length && <Text>Add a checkbox action list or bulleted list to the issue description, then reopen Action Tree.</Text>}
      </>}
      {!run?.done && nodes?.map((node, index) => <Text key={index}>{`${'　'.repeat(node.depth)}${node.actionState ? (node.actionState === 'DONE' ? '☑' : '☐') : '•'} ${node.summary}`}</Text>)}
      {!run?.done && nodes?.some((node) => node.actionState === 'DONE') && <SectionMessage appearance="information" title="Checked actions">
        <Text>Checked actions are included. New Tasks start in the project's default status.</Text>
      </SectionMessage>}
      {run && <>
        {run.done ? <SectionMessage appearance="success" title="Conversion complete">
          <Text>{run.nodes.length} Tasks created and linked under {preview.key}.</Text>
        </SectionMessage> : <>
          <ProgressBar value={complete / (run.nodes.length + 1)} />
          <Text>{complete} of {run.nodes.length} Tasks created and linked. Keep this window open.</Text>
        </>}
        {run.nodes.some((node) => node.key) && <AdfRenderer document={{
          type: 'doc', version: 1, content: [linkedList(run.nodes, run.baseUrl, { createdOnly: true })],
        }} />}
      </>}
      {run?.done && preview.lists.some((list) => !list.error) && <Inline><Button onClick={() => setRun(null)}>Convert another list</Button></Inline>}
      {!run?.done && <Text>Up to 100 items per conversion.</Text>}
      {!run?.done && <Inline><Button appearance="primary" isLoading={busy} isDisabled={busy || (!selected && !run)} onClick={convert}>{run ? 'Resume conversion' : `Create ${selected?.nodes?.length || ''} Tasks`}</Button></Inline>}
    </>}
  </Stack>;
}

