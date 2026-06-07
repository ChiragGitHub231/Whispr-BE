import { FastifyInstance, FastifyPluginAsync } from 'fastify';

const rootRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/', async (request, reply) => {
    return {
      message: 'Welcome to Whispr Chat Application API',
      status: 'active',
    };
  });
};

export default rootRoutes;
