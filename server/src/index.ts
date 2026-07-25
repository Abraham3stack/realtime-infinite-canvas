import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socket/index.js';

const PORT = Number(process.env.PORT) || 3000;
// CLIENT_ORIGIN is set per environment. In dev the Vite HMR server runs on 5173.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(express.json());
// HTTP-level CORS for REST endpoints. Socket.IO manages its own upgrade CORS below.
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));

// Health check: used by the client to confirm the server is reachable before
// attempting the Socket.IO handshake, and by container probes in production.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Wrap Express in a plain Node HTTP server. Socket.IO attaches to the same port
// and handles the WebSocket upgrade from the HTTP connection automatically.
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] accepting socket connections from ${CLIENT_ORIGIN}`);
});
