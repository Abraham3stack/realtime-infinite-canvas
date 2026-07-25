import type { Server, Socket } from 'socket.io';

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[socket] connected  id=${socket.id}`);

    // Send an immediate hello payload so the client can confirm the bidirectional
    // channel is live before any auth or room logic is attempted (M1.C+).
    socket.emit('server:hello', {
      socketId: socket.id,
      serverTs: new Date().toISOString(),
      message: 'Socket connected. Auth and room features arrive in M1.C.',
    });

    // Lightweight round-trip latency probe used by the client's connection status UI.
    socket.on('ping', () => {
      socket.emit('pong', { serverTs: new Date().toISOString() });
    });

    socket.on('disconnect', (reason: string) => {
      console.log(`[socket] disconnected id=${socket.id} reason=${reason}`);
    });
  });
}
