import type { ButtonHTMLAttributes, FC, ReactNode } from 'react';
import { Spinner } from './Spinner.js';

interface LoadingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
}

export const LoadingButton: FC<LoadingButtonProps> = ({
  loading = false,
  loadingLabel,
  children,
  disabled,
  className,
  ...rest
}) => {
  const isDisabled = disabled || loading;

  return (
    <button
      {...rest}
      className={className}
      disabled={isDisabled}
      aria-busy={loading}
      aria-live="polite"
    >
      {loading ? (
        <>
          <Spinner size="sm" tone="light" />
          <span>{loadingLabel ?? 'Loading...'}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
};
