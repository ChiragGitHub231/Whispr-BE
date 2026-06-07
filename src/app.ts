import fastify from 'fastify';
import healthRoutes from './routes/health.js';
import rootRoutes from './routes/root.js';

export function buildApp(opts = {}) {
  const app = fastify(opts);

  // Register routes
  app.register(rootRoutes);
  app.register(healthRoutes);

  return app;
}
