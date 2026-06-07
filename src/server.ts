import { buildApp } from './app.js';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const host = process.env.HOST || '0.0.0.0';

const server = buildApp({
  logger: {
    base: undefined,
    timestamp: () => {
      // add +5:30 for IST
      const istDate = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const formatted = `${pad(istDate.getUTCMonth() + 1)}-${pad(istDate.getUTCDate())}-${istDate.getUTCFullYear()} ${pad(istDate.getUTCHours())}:${pad(istDate.getUTCMinutes())}:${pad(istDate.getUTCSeconds())}`;
      return `"datetime":"${formatted}"`;
    },
    formatters: {
      level: () => ({}),
    },
    serializers: {
      req(request: any) {
        return {
          method: request.method,
          url: request.url,
        };
      },
      res(reply: any) {
        return {
          statusCode: reply.statusCode,
        };
      },
      responseTime(value: number) {
        return `${(value / 1000).toFixed(1)} s`;
      },
    },
    redact: {
      paths: ['reqId'],
      remove: true,
    },
  },
});

const start = async () => {
  try {
    await server.listen({ port, host });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const closeGracefully = async (signal: string) => {
  server.log.info(`Received signal to terminate: ${signal}`);
  try {
    await server.close();
    server.log.info('Server closed successfully.');
    process.exit(0);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

process.on('SIGINT', () => closeGracefully('SIGINT'));
process.on('SIGTERM', () => closeGracefully('SIGTERM'));

start();
