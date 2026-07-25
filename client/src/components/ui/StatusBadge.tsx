import type { FC } from 'react';
import type { ConnectionStatus } from '../../hooks/useConnectionStatus.js';

interface StatusBadgeProps {
  status: ConnectionStatus;
  label: string;
}

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: '#22c55e',
  connecting: '#f59e0b',
  disconnected: '#94a3b8',
  error: '#ef4444',
};

export const StatusBadge: FC<StatusBadgeProps> = ({ status, label }) => {
  return (
    <div className="status-row" role="status" aria-live="polite" aria-label={`Connection status: ${label}`}>
      <span className="status-dot" style={{ backgroundColor: STATUS_COLOR[status] ?? STATUS_COLOR.disconnected }} />
      <strong>{label}</strong>
    </div>
  );
};
