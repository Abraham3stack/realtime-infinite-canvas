import { useEffect, useState } from 'react';
import { socket } from '../socket.js';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ServerHelloPayload {
  socketId: string;
  serverTs: string;
  message: string;
}

export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [serverHello, setServerHello] = useState<ServerHelloPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Register event listeners unconditionally. The socket uses autoConnect: false,
    // so it will not fire 'connect' until setSocketToken() explicitly calls socket.connect()
    // after the user authenticates. We must not guard listener registration behind
    // hasAuth here — the effect runs once at mount (before auth exists), so
    // any auth guard causes listeners to never be registered at all.
    // setSocketToken() in useAuth.ts owns the connect() call.

    // Sync initial state: if the socket is already connected when this effect runs
    // (e.g. HMR reload after auth), reflect that immediately.
    if (socket.connected) {
      setStatus('connected');
    }

    const onConnect = () => {
      setStatus('connected');
      setError(null);
    };

    const onHello = (payload: ServerHelloPayload) => {
      setServerHello(payload);
    };

    const onConnectError = (err: Error) => {
      setStatus('error');
      setError(err.message);
    };

    const onDisconnect = () => {
      setStatus('disconnected');
      setServerHello(null);
    };

    socket.on('connect', onConnect);
    socket.on('server:hello', onHello);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('server:hello', onHello);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      // Do not call socket.disconnect() here. The socket is a singleton shared
      // by the whole app; disconnecting on cleanup would kill the live connection
      // during React StrictMode double-invocation or HMR reloads.
    };
  }, []);

  return { status, serverHello, error };
}
