import { cors } from 'hono/cors';

export const corsMiddleware = cors({
  origin: [
    'https://bratan-corp.github.io',
    'https://bratan-music.eu.cc',
    'http://localhost:5173',
    'http://localhost:3000',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposeHeaders: [
    'Content-Length',
    'Content-Type',
    'Content-Range',
    'Accept-Ranges',
  ],
  maxAge: 86400,
  credentials: true,
});
