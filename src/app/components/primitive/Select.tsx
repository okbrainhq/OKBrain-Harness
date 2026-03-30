import React from 'react';
import styles from './Select.module.css';
import { ChevronDown } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  disabled?: boolean;
  className?: string;
  id?: string;
}

export default function Select({
  value,
  onChange,
  options,
  disabled = false,
  className = '',
  id
}: SelectProps) {
  return (
    <div className={`${styles.selectContainer} ${className}`}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={styles.select}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className={styles.icon}>
        <ChevronDown size={14} />
      </div>
    </div>
  );
}
