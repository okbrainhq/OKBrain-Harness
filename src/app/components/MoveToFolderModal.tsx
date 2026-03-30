import React, { useState, useEffect } from 'react';
import { Modal } from './primitive/Modal';
import Select from './primitive/Select';
import { Button } from './primitive/Button';

interface Folder {
  id: string;
  name: string;
}

interface MoveToFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFolderId: string | null | undefined;
  folders: Folder[];
  onMove: (folderId: string | null) => Promise<void>;
}

export default function MoveToFolderModal({
  isOpen,
  onClose,
  currentFolderId,
  folders,
  onMove,
}: MoveToFolderModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>(currentFolderId || '');
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedFolderId(currentFolderId || '');
    }
  }, [isOpen, currentFolderId]);

  const handleMove = async () => {
    setIsMoving(true);
    try {
      await onMove(selectedFolderId || null);
      onClose();
    } finally {
      setIsMoving(false);
    }
  };

  const options = [
    { value: '', label: 'No Folder' },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Move to Folder"
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose} fullWidth={false}>
            Cancel
          </Button>
          <Button onClick={handleMove} isLoading={isMoving} fullWidth={false}>
            Move
          </Button>
        </div>
      }
    >
      <div style={{ padding: '20px' }}>
        <Select
          id="move-to-folder-select"
          value={selectedFolderId}
          onChange={setSelectedFolderId}
          options={options}
        />
      </div>
    </Modal>
  );
}
