import { chromium } from 'playwright';
import { wrap, configure } from './smart-selector.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { LOGIN_QUERY } from './queries.js';

/**
 * Initialize Smart Selector with OpenAI
 */
export function initializeSmartSelector() {
  configure({
    apiKey: config.openai.apiKey,
  });
  logger.info('Smart Selector configured with OpenAI');
}

/**
 * Create a new browser instance
 * @returns {Promise<{browser: Browser, page: Page}>}
 */
export async function createBrowser() {
  logger.info('Launching browser...', { headless: config.scraper.headless });

  const browser = await chromium.launch({
    headless: config.scraper.headless,
    slowMo: config.scraper.slowMo,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Wrap the page with Smart Selector
  const page = await wrap(await context.newPage());

  logger.info('Browser launched successfully');
  return { browser, page, context };
}

/**
 * Login to Tokko Broker
 * @param {Page} page - Playwright page with Smart Selector
 * @returns {Promise<boolean>} - True if login successful
 */
export async function loginToTokko(page) {
  logger.info('Navigating to Tokko login page...');

  try {
    // Use 'domcontentloaded' instead of 'networkidle' - Tokko has scripts that never stop
    await page.goto(config.tokko.loginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000, // 60 seconds timeout
    });

    // Wait a bit for dynamic content to load
    await page.waitForTimeout(3000);

    logger.info('Querying login form elements...');
    const response = await page.queryElements(LOGIN_QUERY);

    // Fill email
    if (response.email_input) {
      await response.email_input.fill(config.tokko.email);
      logger.debug('Email filled');
    } else {
      logger.warn('Email input not found');
    }

    // Fill password
    if (response.password_input) {
      await response.password_input.fill(config.tokko.password);
      logger.debug('Password filled');
    } else {
      logger.warn('Password input not found');
    }

    // Accept terms if checkbox exists
    if (response.terms_checkbox) {
      try {
        const isChecked = await response.terms_checkbox.isChecked().catch(() => false);
        if (!isChecked) {
          await response.terms_checkbox.click();
          logger.debug('Terms checkbox clicked');
        }
      } catch (e) {
        logger.debug('Could not check terms checkbox, trying click anyway');
        await response.terms_checkbox.click().catch(() => {});
      }
    } else {
      logger.debug('Terms checkbox not found (may not be required)');
    }

    // Accept privacy policy if checkbox exists
    if (response.privacy_checkbox) {
      try {
        const isChecked = await response.privacy_checkbox.isChecked().catch(() => false);
        if (!isChecked) {
          await response.privacy_checkbox.click();
          logger.debug('Privacy checkbox clicked');
        }
      } catch (e) {
        logger.debug('Could not check privacy checkbox, trying click anyway');
        await response.privacy_checkbox.click().catch(() => {});
      }
    } else {
      logger.debug('Privacy checkbox not found (may not be required)');
    }

    // Small delay before clicking login
    await page.waitForTimeout(500);

    // Click login button
    if (response.login_button) {
      await response.login_button.click();
      logger.info('Login button clicked, waiting for navigation...');
    } else {
      throw new Error('Login button not found on page');
    }

    // Wait for navigation after login
    await page.waitForNavigation({
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    }).catch(() => {
      // Sometimes navigation doesn't trigger, just wait
      logger.debug('Navigation wait timed out, continuing...');
    });

    // Extra wait for dashboard to load
    await page.waitForTimeout(3000);

    // Verify login was successful
    const currentUrl = page.url();
    
    // Check for failed login
    if (currentUrl.includes('invalid_login') || currentUrl.includes('error')) {
      throw new Error('Login failed - invalid credentials or missing required fields. Check your TOKKO_EMAIL and TOKKO_PASSWORD in .env');
    }
    
    // Check if still on login page
    if (currentUrl.includes('/go/') && !currentUrl.includes('/home')) {
      throw new Error('Login failed - still on login page. Credentials may be incorrect.');
    }

    logger.info('Login successful!', { redirectedTo: currentUrl });
    return true;
  } catch (error) {
    logger.error('Login failed', { error: error.message });
    throw error;
  }
}

/**
 * Save session cookies for reuse
 * @param {BrowserContext} context
 * @returns {Promise<Array>} - Cookies array
 */
export async function saveSession(context) {
  const cookies = await context.cookies();
  logger.info('Session saved', { cookieCount: cookies.length });
  return cookies;
}

/**
 * Restore session from cookies
 * @param {BrowserContext} context
 * @param {Array} cookies
 */
export async function restoreSession(context, cookies) {
  await context.addCookies(cookies);
  logger.info('Session restored', { cookieCount: cookies.length });
}

