import React, { useState } from 'react';
import ForgeReconciler, { Button, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@forge/react';
import Converter from './converter.jsx';

function Sidebar() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => { if (!busy) setOpen(false); };
  return <>
    <Button appearance="primary" onClick={() => setOpen(true)}>Launch Action Tree</Button>
    <ModalTransition>
      {open && <Modal width="large" onClose={close}>
        <ModalHeader><ModalTitle>Action Tree</ModalTitle></ModalHeader>
        <ModalBody><Converter onBusyChange={setBusy} /></ModalBody>
        <ModalFooter><Button isDisabled={busy} onClick={close}>Close</Button></ModalFooter>
      </Modal>}
    </ModalTransition>
  </>;
}

ForgeReconciler.render(<Sidebar />);
