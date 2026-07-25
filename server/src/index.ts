import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socket/index.js';
import authRouter from './routes/auth.js';
import mediaRouter from './routes/media.js';
import { requireSession } from './middleware/requireSession.js';

// Fail fast on missing DATABASE_URL so the error is obvious during startup
// rather than surfacing as an opaque Prisma connection failure on first request.
if (!process.env.DATABASE_URL) {
  console.error('[server] FATAL: DATABASE_URL environment variable is not set.');
  console.error('[server] Copy server/.env.example to server/.env and set a valid PostgreSQL connection string.');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
// CLIENT_ORIGIN is set per environment. In dev the Vite HMR server runs on 5173.
// Support multiple dev ports to handle concurrent sessions or port conflicts.
const getDevelopmentOrigins = () => {
  const baseOrigin = 'http://localhost';
  return [5173, 5174, 5175, 5176].map(port => `${baseOrigin}:${port}`);
};

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
// In development, allow multiple Vite ports to handle concurrent development
const corsOrigin = process.env.NODE_ENV === 'development' 
  ? getDevelopmentOrigins() 
  : CLIENT_ORIGIN;

const app = express();
app.use(express.json());
// HTTP-level CORS for REST endpoints. Socket.IO manages its own upgrade CORS below.
app.use(cors({ origin: corsOrigin, credentials: true }));

// Health check: used by the client to confirm the server is reachable before
// attempting the Socket.IO handshake, and by container probes in production.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Guest authentication — create and validate lightweight session tokens.
app.use('/auth', authRouter);
app.use('/media', requireSession, mediaRouter);

// Wrap Express in a plain Node HTTP server. Socket.IO attaches to the same port
// and handles the WebSocket upgrade from the HTTP connection automatically.
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] accepting socket connections from ${CLIENT_ORIGIN}`);
});
