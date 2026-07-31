import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { query } from './db/pool.js';
import { errorHandler } from './middleware/errorHandler.js';
import adminRoutes from './routes/admin.js';
import referralRoutes from './routes/referral.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testHtml = fs.readFileSync(path.join(__dirname, 'test-client.html'), 'utf-8');

export function createApp() {
  const app = express();

  // Trust Railway's proxy for correct client IPs (rate limiting)
  app.set('trust proxy', 1);

  // Security headers (relaxed for Telegram WebView)
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    originAgentCluster: false,
  }));

  // CORS — allow configured origin only in production
  const corsOrigins = config.cors.origin
    ? (config.cors.origin === '*' ? '*' : config.cors.origin.split(',').map(s => s.trim()))
    : false;
  app.use(cors({
    origin: corsOrigins,
    credentials: true,
  }));

  app.use(express.json({ limit: '10kb' }));

  // Serve static frontend + socket.io client
  const frontendPath = path.resolve(__dirname, '../public');
  app.use((_req, res, next) => {
    if (_req.path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });
  app.use(express.static(frontendPath, { maxAge: 0, etag: false, lastModified: false }));
  app.use('/socket.io', express.static(path.join(__dirname, '../node_modules/socket.io/client-dist'), { maxAge: 0, etag: false, lastModified: false }));

  // Root serves the app
  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  // Rate limiting for API routes
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: config.isDev ? 1000 : 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });

  app.use('/api', apiLimiter);
  app.use('/health', apiLimiter);

  app.use('/api/admin', adminRoutes);
  app.use('/api/referral', referralRoutes);

  // Health check
  app.get('/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok', uptime: process.uptime(), database: 'ok' });
    } catch (err) {
      console.error('[health] Database check failed:', err.message);
      res.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
  });

  // Test client (dev only)
  if (config.isDev) {
    app.get('/test', (_req, res) => {
      res.type('html').send(testHtml);
    });
  }

  app.use(errorHandler);

  return app;
}
