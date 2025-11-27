import express from 'express';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import leadsRouter from './routes/leads.js';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    query: req.query,
    body: req.method === 'POST' ? req.body : undefined,
  });
  next();
});

// Routes
app.use('/api/leads', leadsRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Tokko Lead Scraper API',
    version: '1.0.0',
    endpoints: {
      'POST /api/leads/scrape': 'Start a scraping job',
      'GET /api/leads/health': 'Health check',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

/**
 * Start the server
 */
export function startServer() {
  const port = config.server.port;

  app.listen(port, () => {
    logger.info(`🚀 Tokko Lead Scraper API running on port ${port}`);
    logger.info(`   Environment: ${config.server.env}`);
    logger.info(`   Health check: http://localhost:${port}/api/leads/health`);
  });

  return app;
}

export default app;

