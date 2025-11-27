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
 * Direct CSS selectors for Tokko login page
 * These are more reliable than Smart Selector for login
 */
const LOGIN_SELECTORS = {
  username: '#username',
  password: '#password',
  termsCheckbox: '#agreeterms',
  privacyCheckbox: '#agreepolicy',
  // The login button is a div with "Acceder" text, not a traditional button
  loginButton: 'div[cursor="pointer"]:has-text("Acceder"), .login-button, button:has-text("Acceder"), [role="button"]:has-text("Acceder")',
};

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

    logger.info('Filling login form with direct selectors...');

    // Fill username/email using direct selector
    const usernameInput = await page.$(LOGIN_SELECTORS.username);
    if (usernameInput) {
      await page.fill(LOGIN_SELECTORS.username, config.tokko.email);
      logger.debug('Username/email filled');
    } else {
      logger.warn('Username input not found, trying Smart Selector fallback...');
      const response = await page.queryElements(LOGIN_QUERY);
      if (response.email_input) {
        await response.email_input.fill(config.tokko.email);
        logger.debug('Email filled via Smart Selector');
      } else {
        throw new Error('Could not find username/email input field');
      }
    }

    // Fill password using direct selector
    const passwordInput = await page.$(LOGIN_SELECTORS.password);
    if (passwordInput) {
      await page.fill(LOGIN_SELECTORS.password, config.tokko.password);
      logger.debug('Password filled');
    } else {
      logger.warn('Password input not found, trying Smart Selector fallback...');
      const response = await page.queryElements(LOGIN_QUERY);
      if (response.password_input) {
        await response.password_input.fill(config.tokko.password);
        logger.debug('Password filled via Smart Selector');
      } else {
        throw new Error('Could not find password input field');
      }
    }

    // Check terms checkbox if not already checked
    try {
      const termsCheckbox = await page.$(LOGIN_SELECTORS.termsCheckbox);
      if (termsCheckbox) {
        const isChecked = await page.isChecked(LOGIN_SELECTORS.termsCheckbox);
        if (!isChecked) {
          await page.click(LOGIN_SELECTORS.termsCheckbox);
          logger.debug('Terms checkbox clicked');
        } else {
          logger.debug('Terms checkbox already checked');
        }
      }
    } catch (e) {
      logger.debug('Could not interact with terms checkbox', { error: e.message });
    }

    // Check privacy checkbox if not already checked
    try {
      const privacyCheckbox = await page.$(LOGIN_SELECTORS.privacyCheckbox);
      if (privacyCheckbox) {
        const isChecked = await page.isChecked(LOGIN_SELECTORS.privacyCheckbox);
        if (!isChecked) {
          await page.click(LOGIN_SELECTORS.privacyCheckbox);
          logger.debug('Privacy checkbox clicked');
        } else {
          logger.debug('Privacy checkbox already checked');
        }
      }
    } catch (e) {
      logger.debug('Could not interact with privacy checkbox', { error: e.message });
    }

    // Small delay before clicking login
    await page.waitForTimeout(500);

    // Click login button - try multiple selectors since it's a div, not a button
    logger.info('Looking for login button...');
    let loginClicked = false;

    // Try to find by text content "Acceder"
    const accederButton = page.locator('text=Acceder').first();
    if (await accederButton.isVisible().catch(() => false)) {
      await accederButton.click();
      loginClicked = true;
      logger.info('Login button clicked (text=Acceder)');
    }

    // Fallback: try other selectors
    if (!loginClicked) {
      const selectors = [
        'div:has-text("Acceder")',
        '[class*="login"]',
        '[class*="submit"]',
        'button[type="submit"]',
        'input[type="submit"]',
      ];
      
      for (const selector of selectors) {
        try {
          const el = page.locator(selector).first();
          if (await el.isVisible().catch(() => false)) {
            await el.click();
            loginClicked = true;
            logger.info(`Login button clicked (${selector})`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    // Last resort: Smart Selector
    if (!loginClicked) {
      logger.warn('Direct selectors failed, trying Smart Selector for login button...');
      const response = await page.queryElements(LOGIN_QUERY);
      if (response.login_button) {
        await response.login_button.click();
        loginClicked = true;
        logger.info('Login button clicked via Smart Selector');
      }
    }

    if (!loginClicked) {
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

