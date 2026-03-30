import React from 'react';
import styles from './Checkbox.module.css';

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, className, ...props }, ref) => {
    return (
      <label className={`${styles.checkboxContainer} ${className || ''}`}>
        <input
          type="checkbox"
          className={styles.checkboxInput}
          ref={ref}
          {...props}
        />
        {label && <span className={styles.checkboxLabel}>{label}</span>}
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
