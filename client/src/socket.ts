import { io, Socket } from 'socket.io-client';

// SERVER_URL is injected by Vite at build time from the .env file.
// The fallback keeps things working in environments without an env file (e.g. CI builds).
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

// Singleton socket - one connection for the entire application lifetime.
// autoConnect: false defers connection until the app shell explicitly calls
// socket.connect(), preventing stale connections during pre-auth renders.
export const socket: Socket = io(SERVER_URL, {
  autoConnect: false,
  // Prefer WebSocket, fall back to long-polling if WS is unavailable.
  transports: ['websocket', 'polling'],
});
