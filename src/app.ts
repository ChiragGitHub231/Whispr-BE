import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import healthRoutes from './routes/health.js';
import rootRoutes from './routes/root.js';
import authRoutes from './routes/auth.js';
import roomsRoutes from './routes/rooms.js';
import messageRoutes from './routes/messages.js';

export function buildApp(opts = {}) {
  const app = fastify({
    bodyLimit: 78643200, // 75MB body limit to handle large attachment uploads (accounts for ~33% Base64 expansion of 50MB files)
    ...opts,
  });

  // Configure CORS to allow dev server with credentials (cookies)
  app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps or curl) or local development origins
      if (!origin || /https?:\/\/localhost:\d+$/.test(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  // Configure Cookie parsing
  app.register(fastifyCookie);

  // Configure JWT validation via cookies
  app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || '',
    cookie: {
      cookieName: 'token',
      signed: false,
    },
  });

  // Enable websocket support for live chat events
  app.register(fastifyWebsocket);

  // Register routes
  app.register(rootRoutes);
  app.register(healthRoutes);
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(roomsRoutes, { prefix: '/api/rooms' });
  app.register(messageRoutes);

  return app;
}
