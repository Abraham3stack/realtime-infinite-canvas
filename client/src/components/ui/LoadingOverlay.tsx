import type { FC } from 'react';
import { Spinner } from './Spinner.js';

interface LoadingOverlayProps {
  message: string;
  subMessage?: string;
}

export const LoadingOverlay: FC<LoadingOverlayProps> = ({ message, subMessage }) => {
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="loading-overlay-card">
        <Spinner size="md" />
        <div>
          <p className="card-strong">{message}</p>
          {subMessage ? <p className="subtle-text">{subMessage}</p> : null}
        </div>
      </div>
    </div>
  );
};
