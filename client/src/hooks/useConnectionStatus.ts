import { useEffect, useRef, useState } from 'react';
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
  const [statusLabel, setStatusLabel] = useState('Disconnected');
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectingRef = useRef(false);

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
      setStatusLabel('Connected');
    }

    const onConnect = () => {
      const wasReconnecting = reconnectingRef.current;
      setStatus('connected');
      setStatusLabel(wasReconnecting ? 'Reconnected' : 'Connected');
      setReconnecting(false);
      reconnectingRef.current = false;
      setError(null);

      if (wasReconnecting) {
        window.setTimeout(() => {
          setStatusLabel('Connected');
        }, 1400);
      }
    };

    const onHello = (payload: ServerHelloPayload) => {
      setServerHello(payload);
    };

    const onConnectError = (err: Error) => {
      setStatus('error');
      setStatusLabel(reconnectingRef.current ? 'Reconnecting...' : 'Connection Error');
      setError(err.message);
    };

    const onDisconnect = () => {
      setStatus('disconnected');
      setStatusLabel('Disconnected');
      setServerHello(null);
      setReconnecting(false);
      reconnectingRef.current = false;
    };

    const onReconnectAttempt = () => {
      setStatus('connecting');
      setStatusLabel('Reconnecting...');
      setReconnecting(true);
      reconnectingRef.current = true;
      setError(null);
    };

    const onReconnectFailed = () => {
      setStatus('error');
      setStatusLabel('Reconnect Failed');
      setReconnecting(false);
      reconnectingRef.current = false;
    };

    socket.on('connect', onConnect);
    socket.on('server:hello', onHello);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect_failed', onReconnectFailed);

    return () => {
      socket.off('connect', onConnect);
      socket.off('server:hello', onHello);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect_failed', onReconnectFailed);
      // Do not call socket.disconnect() here. The socket is a singleton shared
      // by the whole app; disconnecting on cleanup would kill the live connection
      // during React StrictMode double-invocation or HMR reloads.
    };
  }, []);

  return { status, statusLabel, reconnecting, serverHello, error };
}
