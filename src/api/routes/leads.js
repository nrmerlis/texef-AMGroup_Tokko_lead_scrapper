import { Router } from 'express';
import { scrapeLeads } from '../../scraper/index.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * POST /api/leads/scrape
 * Start a new scraping job
 *
 * Body:
 * {
 *   "targetDate": "2024-01-01",     // Required: Scrape leads until this date
 *   "status": "pendiente_contactar", // Optional: Lead status filter (default: pendiente_contactar)
 *                                   // Options: para_reasignacion, sin_seguimiento, pendiente_contactar,
 *                                   //          esperando_respuesta, evolucionando, tomar_accion, congelado, all
 *   "startDate": "2024-01-15",      // Optional: Filter leads from this date
 *   "maxLeads": 100,                // Optional: Max leads to scrape (default: 10000)
 *   "extractDetails": true          // Optional: Extract contact email/phone by clicking (slower but more data)
 * }
 */
router.post('/scrape', async (req, res) => {
  try {
    const { targetDate, startDate, maxLeads, extractDetails, status } = req.body;

    if (!targetDate) {
      return res.status(400).json({
        success: false,
        error: 'targetDate is required (format: YYYY-MM-DD)',
      });
    }

    const parsedTargetDate = new Date(targetDate);
    if (isNaN(parsedTargetDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid targetDate format. Use YYYY-MM-DD',
      });
    }

    // Valid status options
    const validStatuses = [
      'para_reasignacion',
      'sin_seguimiento', 
      'pendiente_contactar',
      'esperando_respuesta',
      'evolucionando',
      'tomar_accion',
      'congelado',
      'all'
    ];

    const selectedStatus = status || 'pendiente_contactar';
    
    if (!validStatuses.includes(selectedStatus)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Valid options: ${validStatuses.join(', ')}`,
      });
    }

    const options = {
      targetDate: parsedTargetDate,
      startDate: startDate ? new Date(startDate) : null,
      maxLeads: maxLeads || 10000,
      extractDetails: extractDetails || false,
      status: selectedStatus,
    };

    logger.info('Received scrape request', options);

    // Start scraping (this may take a while)
    const result = await scrapeLeads(options);

    if (result.success) {
      res.json({
        success: true,
        data: {
          leads: result.leads,
          metadata: result.metadata,
        },
      });
    } else {
      // Check if it's a session closed error
      if (result.isSessionClosed) {
        return res.status(500).json({
          success: false,
          error: 'Sesión cerrada inesperadamente. Otro usuario se conectó con las mismas credenciales. Por favor, intente de nuevo.',
          code: 'SESSION_CLOSED',
        });
      }

      res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    logger.error('Error in /api/leads/scrape', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/leads/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

export default router;

