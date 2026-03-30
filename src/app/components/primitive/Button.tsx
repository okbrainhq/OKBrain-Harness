import React from 'react';
import styles from './Button.module.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'brand';
  icon?: React.ReactNode;
  children: React.ReactNode;
  fullWidth?: boolean;
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  icon,
  children,
  className,
  fullWidth = true,
  isLoading = false,
  disabled,
  ...props
}) => {
  const variantClass = variant !== 'primary' ? styles[variant] : '';
  const widthClass = fullWidth ? styles.fullWidth : '';

  const classNames = [
    styles.button,
    variantClass,
    widthClass,
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      className={classNames}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className={styles.spinner}></span>
      ) : (
        <>
          {icon && <span className={styles.icon}>{icon}</span>}
          {children}
        </>
      )}
    </button>
  );
};
