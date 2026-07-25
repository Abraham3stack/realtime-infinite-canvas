import type { FC } from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md';
  tone?: 'default' | 'light';
  className?: string;
}

export const Spinner: FC<SpinnerProps> = ({ size = 'md', tone = 'default', className }) => {
  const spinnerClass = ['ui-spinner', `ui-spinner--${size}`, `ui-spinner--${tone}`, className].filter(Boolean).join(' ');

  return <span className={spinnerClass} aria-hidden="true" />;
};
