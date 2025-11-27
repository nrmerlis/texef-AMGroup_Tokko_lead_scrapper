import { logger } from '../utils/logger.js';
import {
  initializeSmartSelector,
  createBrowser,
  loginToTokko,
  saveSession,
} from './auth.js';
import { navigateToLeads, scrapeLeadsUntilDate, applyDateFilter } from './leads.js';

/**
 * Main scraper function - orchestrates the entire scraping process
 * @param {Object} options
 * @param {Date} options.targetDate - Scrape leads until this date
 * @param {Date} options.startDate - Optional start date for filtering
 * @param {number} options.maxLeads - Maximum leads to scrape
 * @param {boolean} options.extractDetails - Click each property to get ID and agent
 * @param {string} options.status - Filter by lead status (all, por_asignar, esperando_respuesta, etc.)
 * @returns {Promise<{success: boolean, leads: Array, error?: string}>}
 */
export async function scrapeLeads(options = {}) {
  const {
    targetDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Default: 7 days ago
    startDate = null,
    maxLeads = 10000,
    extractDetails = false,
    status = 'all',
  } = options;

  let browser = null;
  let context = null;

  try {
    logger.info('Starting Tokko Lead Scraper', {
      targetDate: targetDate.toISOString(),
      maxLeads,
      extractDetails,
      status,
    });

    // Initialize Smart Selector (OpenAI)
    initializeSmartSelector();

    // Create browser instance
    const browserInstance = await createBrowser();
    browser = browserInstance.browser;
    context = browserInstance.context;
    const page = browserInstance.page;

    // Login to Tokko
    await loginToTokko(page);

    // Navigate to leads section
    await navigateToLeads(page);

    // Apply date filter if start date is provided
    if (startDate) {
      await applyDateFilter(page, startDate, new Date());
    }

    // Scrape leads with scroll
    const leads = await scrapeLeadsUntilDate(page, targetDate, { 
      maxLeads,
      extractDetails,
      status,
    });

    // Save session for future use
    const cookies = await saveSession(context);

    logger.info('Scraping completed successfully', {
      leadsCount: leads.length,
    });

    return {
      success: true,
      leads,
      metadata: {
        scrapedAt: new Date().toISOString(),
        targetDate: targetDate.toISOString(),
        totalLeads: leads.length,
      },
    };
  } catch (error) {
    logger.error('Scraping failed', { error: error.message, stack: error.stack });

    return {
      success: false,
      leads: [],
      error: error.message,
    };
  } finally {
    // Always close the browser
    if (browser) {
      await browser.close();
      logger.info('Browser closed');
    }
  }
}

// Allow running directly from command line
const isMainModule = process.argv[1]?.includes('scraper/index.js');

if (isMainModule) {
  const targetDate = process.argv[2]
    ? new Date(process.argv[2])
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  scrapeLeads({ targetDate })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

