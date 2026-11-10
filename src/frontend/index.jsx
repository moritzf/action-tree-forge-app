import React, { useState } from 'react';
import ForgeReconciler, { Button, Modal, ModalBody, ModalHeader, ModalTitle, ModalTransition } from '@forge/react';
import Converter from './converter.jsx';

function Sidebar() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <>
    <Button appearance="primary" onClick={() => setOpen(true)}>Convert with Action Tree</Button>
    <ModalTransition>
      {open && <Modal width="large" onClose={close}>
        <ModalHeader><ModalTitle>Action Tree</ModalTitle></ModalHeader>
        <ModalBody><Converter onClose={close} /></ModalBody>
      </Modal>}
    </ModalTransition>
  </>;
}

ForgeReconciler.render(<Sidebar />);
