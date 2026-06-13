import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import healthRoutes from './routes/health.js';
import rootRoutes from './routes/root.js';
import authRoutes from './routes/auth.js';
import roomsRoutes from './routes/rooms.js';

export function buildApp(opts = {}) {
  const app = fastify(opts);

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

  // Register routes
  app.register(rootRoutes);
  app.register(healthRoutes);
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(roomsRoutes, { prefix: '/api/rooms' });

  return app;
}
