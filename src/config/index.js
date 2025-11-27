import 'dotenv/config';

export const config = {
  // OpenAI for Smart Selector
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },

  // Tokko Broker credentials
  tokko: {
    email: process.env.TOKKO_EMAIL,
    password: process.env.TOKKO_PASSWORD,
    loginUrl: 'https://www.tokkobroker.com/go/',
    baseUrl: 'https://www.tokkobroker.com',
  },

  // Server
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
  },

  // Scraper settings
  scraper: {
    headless: process.env.HEADLESS === 'true',
    slowMo: parseInt(process.env.SLOW_MO, 10) || 0,
    timeout: 30000,
  },
};

