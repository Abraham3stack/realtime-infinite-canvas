import { FC } from 'react';
import { useConnectionStatus } from './hooks/useConnectionStatus';

const STATUS_COLOR: Record<string, string> = {
  connected: '#22c55e',
  connecting: '#f59e0b',
  disconnected: '#94a3b8',
  error: '#ef4444',
};

const App: FC = () => {
  const { status, serverHello, error } = useConnectionStatus();

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '640px' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Realtime Infinite Canvas</h1>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#64748b' }}>
          SERVER CONNECTION
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: STATUS_COLOR[status] ?? STATUS_COLOR.disconnected,
              display: 'inline-block',
            }}
          />
          <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{status}</span>
        </div>
        {error && (
          <p style={{ color: STATUS_COLOR.error, fontSize: '0.8rem', marginTop: '0.5rem' }}>
            {error}
          </p>
        )}
      </section>

      {serverHello && (
        <section>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#64748b' }}>
            SERVER HELLO
          </h2>
          <pre
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '1rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              overflow: 'auto',
            }}
          >
            {JSON.stringify(serverHello, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
};

export default App;
