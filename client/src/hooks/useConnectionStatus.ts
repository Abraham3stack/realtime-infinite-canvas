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
    // Only attempt connection if socket has auth (token) available.
    // This prevents unauthenticated connection attempts.
    const hasAuth = socket.auth && typeof socket.auth === 'object' && 'token' in socket.auth;
    if (!hasAuth) {
      return;
    }

    setStatus('connecting');
    // Initiate the WebSocket handshake. The socket was created with autoConnect: false
    // so no connection is attempted until the app shell has rendered AND a token is available.
    socket.connect();

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
      // Clean up listeners on unmount. In normal app operation this only fires
      // during HMR reloads; actual disconnect is handled by the server detecting
      // the broken TCP connection.
      socket.off('connect', onConnect);
      socket.off('server:hello', onHello);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      socket.disconnect();
    };
  }, []);

  return { status, serverHello, error };
}
