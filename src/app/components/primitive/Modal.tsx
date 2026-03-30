import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';
import { Button } from './Button';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: 'desktop' | 'mobile' | 'auto';
  showCloseButton?: boolean;
  className?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  variant = 'auto',
  showCloseButton = true,
  className,
}) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (variant !== 'auto') return;

    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [variant]);
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const determineVariant = () => {
    if (variant === 'auto') return isMobile ? 'mobile' : 'desktop';
    return variant;
  };

  const actualVariant = determineVariant();
  const modalClass = actualVariant === 'mobile' ? styles.modalMobile : styles.modalDesktop;

  const modalClassNames = [
    styles.modal,
    modalClass,
    className
  ].filter(Boolean).join(' ');

  // Use a portal to render the modal at the end of the document body
  // This avoids stacking context issues especially on mobile with other fixed elements
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={modalClassNames}>
        {(title || showCloseButton) && (
          <div className={styles.header}>
            {title && <h3 className={styles.title}>{title}</h3>}
            {showCloseButton && (
              <Button className={styles.closeButton} onClick={onClose} fullWidth={false}>
                ✕
              </Button>
            )}
          </div>
        )}
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </>,
    document.body
  );
};
