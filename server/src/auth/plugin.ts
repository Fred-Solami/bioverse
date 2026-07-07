import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { config } from '../config.js';
import { isRole, type Role } from './roles.js';

// The identity carried inside the access token. `sub` is the user id; facility
// and district drive RBAC scoping in handlers.
export interface AuthUser {
  sub: string;
  role: Role;
  facilityId: string | null;
  district: string | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: Role[]
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

export const authPlugin = fp(async (app) => {
  app.register(cookie);
  app.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.accessTokenTtl },
  });

  // Verifies the Bearer access token and pins the decoded identity onto the
  // request. 401 on any failure — never leak *why* verification failed.
  app.decorate(
    'authenticate',
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = await req.jwtVerify<AuthUser>();
        if (!isRole(payload.role)) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
        req.authUser = payload;
      } catch {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    },
  );

  // Route-level role gate. Assumes `authenticate` ran first (preHandler order).
  app.decorate('requireRole', (...roles: Role[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.authUser;
      if (!user) return reply.code(401).send({ error: 'unauthorized' });
      if (!roles.includes(user.role)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
    };
  });
});
