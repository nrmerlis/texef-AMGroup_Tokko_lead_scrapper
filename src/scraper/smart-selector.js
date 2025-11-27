/**
 * Smart Selector - Intelligent element finder using OpenAI
 * 
 * Uses natural language queries to find HTML elements on a page.
 * 
 * Usage:
 * 
 *   const page = await wrap(playwrightPage);
 *   
 *   const response = await page.queryElements(`
 *     {
 *       login_form {
 *         email_input
 *         password_input
 *         submit_btn
 *       }
 *     }
 *   `);
 *   
 *   await response.login_form.email_input.fill("user@email.com");
 *   await response.login_form.submit_btn.click();
 */

import OpenAI from 'openai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let openai = null;

/**
 * Initialize OpenAI client
 */
export function configure(options = {}) {
  const apiKey = options.apiKey || config.openai?.apiKey;
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY in .env');
  }
  
  openai = new OpenAI({ apiKey });
  logger.info('Smart Selector configured with OpenAI');
}

/**
 * Clean HTML to reduce tokens
 */
function cleanHTML(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
    .replace(/\s+data-[a-z-]+="[^"]*"/gi, '')
    .replace(/\s+style="[^"]*"/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse query into structured format
 * Input: "{ login_form { email_input password_input } }"
 * Output: { login_form: { email_input: null, password_input: null } }
 */
function parseQuery(query) {
  const cleanQuery = query.trim();
  
  // Simple recursive parser for the query structure
  function parse(str) {
    const result = {};
    
    // Remove outer braces
    let content = str.trim();
    if (content.startsWith('{')) {
      content = content.slice(1);
    }
    if (content.endsWith('}')) {
      content = content.slice(0, -1);
    }
    
    content = content.trim();
    if (!content) return result;
    
    // Find all fields (considering nested braces)
    let depth = 0;
    let currentField = '';
    let fieldName = '';
    let inFieldName = true;
    
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      
      if (char === '{') {
        depth++;
        inFieldName = false;
        currentField += char;
      } else if (char === '}') {
        depth--;
        currentField += char;
        
        if (depth === 0) {
          // End of nested object
          result[fieldName.trim()] = parse(currentField);
          currentField = '';
          fieldName = '';
          inFieldName = true;
        }
      } else if (depth > 0) {
        currentField += char;
      } else if (char === '\n' || (char === ' ' && content[i+1] !== '{')) {
        if (fieldName.trim() && !currentField) {
          // Simple field without children
          const name = fieldName.trim();
          if (name && !result[name]) {
            // Check if it's an array field (ends with [])
            if (name.endsWith('[]')) {
              result[name.slice(0, -2)] = [];
            } else {
              result[name] = null;
            }
          }
          fieldName = '';
        }
        inFieldName = true;
      } else {
        if (inFieldName) {
          fieldName += char;
        } else {
          currentField += char;
        }
      }
    }
    
    // Handle last field if any
    if (fieldName.trim()) {
      const name = fieldName.trim();
      if (name.endsWith('[]')) {
        result[name.slice(0, -2)] = [];
      } else {
        result[name] = null;
      }
    }
    
    return result;
  }
  
  return parse(cleanQuery);
}

/**
 * Convert parsed query structure to a flat list of field paths
 */
function getFieldPaths(obj, prefix = '') {
  const paths = [];
  
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    
    if (value === null) {
      paths.push(path);
    } else if (Array.isArray(value)) {
      paths.push(`${path}[]`);
    } else if (typeof value === 'object') {
      paths.push(...getFieldPaths(value, path));
    }
  }
  
  return paths;
}

/**
 * Ask LLM to find selectors for all fields in the query
 */
async function findSelectors(html, queryStructure) {
  if (!openai) {
    configure();
  }

  const fieldPaths = getFieldPaths(queryStructure);
  
  const prompt = `You are an expert at finding HTML elements. Given this HTML and a list of element descriptions, find the CSS selector for each.

ELEMENTS TO FIND:
${fieldPaths.map(p => `- "${p}"`).join('\n')}

RULES:
1. Return a JSON object where each key is EXACTLY as listed above (copy the key name exactly)
2. The value should be a valid CSS selector
3. Use specific selectors: #id, [name="x"], [class*="specific"], input[type="email"]
4. For text-based finding use: button:has-text("Login"), a:has-text("Submit")
5. For arrays/lists (marked with []), return selector that matches ALL items
6. If element not found, use null
7. Return ONLY valid JSON, no explanations

Example - if elements are: "email_input", "password_input", "login_button"
Response should be:
{
  "email_input": "input[name='email']",
  "password_input": "input[type='password']",
  "login_button": "button[type='submit']"
}

HTML:
${html}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You find CSS selectors in HTML. Return only valid JSON with selectors.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0,
    max_tokens: 2000,
  });

  let result = response.choices[0]?.message?.content?.trim() || '{}';
  
  // Clean JSON
  result = result
    .replace(/^```json\n?/i, '')
    .replace(/^```\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  return JSON.parse(result);
}

/**
 * Create a proxy object that wraps selectors with Playwright element handles
 */
function createResponseProxy(page, selectors, structure, prefix = '') {
  const proxy = {};
  
  for (const [key, value] of Object.entries(structure)) {
    const path = prefix ? `${prefix}.${key}` : key;
    
    if (value === null) {
      // Leaf node - create element wrapper
      const selector = selectors[path];
      proxy[key] = createElementProxy(page, selector, path);
    } else if (Array.isArray(value)) {
      // Array field - will be handled specially
      const selector = selectors[`${path}[]`] || selectors[path];
      proxy[key] = createArrayProxy(page, selector, path);
    } else if (typeof value === 'object') {
      // Nested object - recurse
      proxy[key] = createResponseProxy(page, selectors, value, path);
    }
  }
  
  return proxy;
}

/**
 * Create a proxy for a single element with Playwright-like methods
 */
function createElementProxy(page, selector, fieldName) {
  if (!selector) {
    logger.warn(`No selector found for: ${fieldName}`);
    return null;
  }

  return {
    _selector: selector,
    _fieldName: fieldName,
    
    async click(options = {}) {
      logger.debug(`Clicking: ${fieldName} (${selector})`);
      await page.click(selector, options);
    },
    
    async fill(value) {
      logger.debug(`Filling: ${fieldName} (${selector})`);
      await page.fill(selector, value);
    },
    
    async type(text, options = {}) {
      logger.debug(`Typing in: ${fieldName} (${selector})`);
      await page.type(selector, text, options);
    },
    
    async textContent() {
      return await page.textContent(selector);
    },
    
    async innerText() {
      return await page.innerText(selector);
    },
    
    async getAttribute(name) {
      return await page.getAttribute(selector, name);
    },
    
    async isVisible() {
      return await page.isVisible(selector);
    },
    
    async isChecked() {
      return await page.isChecked(selector);
    },
    
    async check() {
      await page.check(selector);
    },
    
    async uncheck() {
      await page.uncheck(selector);
    },
    
    async selectOption(value) {
      await page.selectOption(selector, value);
    },
    
    async hover() {
      await page.hover(selector);
    },
    
    async waitFor(options = {}) {
      await page.waitForSelector(selector, options);
    },

    // Get the raw Playwright locator
    async getLocator() {
      return page.locator(selector);
    },
  };
}

/**
 * Create a proxy for array/list elements
 */
function createArrayProxy(page, selector, fieldName) {
  if (!selector) {
    logger.warn(`No selector found for array: ${fieldName}`);
    return [];
  }

  return {
    _selector: selector,
    _fieldName: fieldName,
    _isArray: true,
    
    async count() {
      return await page.locator(selector).count();
    },
    
    async all() {
      const count = await page.locator(selector).count();
      const items = [];
      for (let i = 0; i < count; i++) {
        items.push(createElementProxy(page, `${selector}:nth-child(${i + 1})`, `${fieldName}[${i}]`));
      }
      return items;
    },
    
    async nth(index) {
      return createElementProxy(page, `${selector}:nth-child(${index + 1})`, `${fieldName}[${index}]`);
    },
    
    async first() {
      return createElementProxy(page, `${selector}:first-child`, `${fieldName}[0]`);
    },
    
    async last() {
      return createElementProxy(page, `${selector}:last-child`, `${fieldName}[last]`);
    },
  };
}

/**
 * Wrap a Playwright page with queryElements method
 * @param {Page} playwrightPage - The Playwright page object
 * @returns {Page} - Enhanced page with queryElements method
 */
export function wrap(playwrightPage) {
  // Add queryElements method to the page
  playwrightPage.queryElements = async function(query) {
    logger.debug('Executing smart query...');
    
    // Parse the query
    const structure = parseQuery(query);
    logger.debug('Parsed query structure', { structure });
    
    // Get page HTML
    const html = await playwrightPage.content();
    const cleanedHtml = cleanHTML(html);
    
    // Truncate if needed
    const maxLength = 40000;
    const truncatedHtml = cleanedHtml.length > maxLength 
      ? cleanedHtml.substring(0, maxLength) + '\n...[truncated]...'
      : cleanedHtml;
    
    // Find selectors using LLM
    const selectors = await findSelectors(truncatedHtml, structure);
    logger.debug('Found selectors', { selectors });
    
    // Create response proxy
    return createResponseProxy(playwrightPage, selectors, structure);
  };
  
  return playwrightPage;
}

/**
 * Extract leads data directly from HTML using LLM
 * This is more reliable than trying to find selectors for complex data
 * @param {string} html - Page HTML content
 * @returns {Promise<Array>} - Array of lead objects
 */
export async function extractLeadsFromHTML(html) {
  if (!openai) {
    configure();
  }

  const cleanedHtml = cleanHTML(html);
  
  // Truncate if needed (leads data is usually in a specific section)
  const maxLength = 60000;
  const truncatedHtml = cleanedHtml.length > maxLength 
    ? cleanedHtml.substring(0, maxLength) + '\n...[truncated]...'
    : cleanedHtml;

  const prompt = `You are extracting lead/contact data from Tokko Broker CRM.

The page shows a TABLE of leads with these columns:
- Contacto: Contact name with agent in parentheses, e.g. "Johanna Rios (Emiliano Grieve)"
- Búsqueda / Propiedad: Property address, e.g. "Colombres 148 2" or "Benjamin Matienzo 1724 Piso 6"
- Vigencia: A progress bar (ignore this)
- Notas: Note icons
- Actualizado: Date like "26/11/2025 08:15"

Each ROW in the table is a lead. Look for table rows (tr), list items, or div rows containing this data.

Extract ALL leads visible. For each lead return:
{
  "contactName": "the contact name without the agent part",
  "agentName": "the name in parentheses (the responsible agent)",
  "propertyAddress": "the property address from Búsqueda/Propiedad column",
  "lastUpdated": "the date from Actualizado column",
  "status": "the section header like 'Pendiente contactar' if visible"
}

Return ONLY a valid JSON array. Example:
[
  {"contactName": "Johanna Rios", "agentName": "Emiliano Grieve", "propertyAddress": "Colombres 148 2", "lastUpdated": "26/11/2025 08:15", "status": "Pendiente contactar"},
  {"contactName": "Marcela", "agentName": "Graciela", "propertyAddress": "Benjamin Matienzo 1724", "lastUpdated": "26/11/2025 09:33", "status": "Pendiente contactar"}
]

HTML:
${truncatedHtml}`;

  try {
    logger.debug('Extracting leads from HTML with LLM...');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You extract structured data from HTML. Return only valid JSON arrays.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0,
      max_tokens: 8000,
    });

    let result = response.choices[0]?.message?.content?.trim() || '[]';
    
    // Clean JSON
    result = result
      .replace(/^```json\n?/i, '')
      .replace(/^```\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    const leads = JSON.parse(result);
    logger.debug(`LLM extracted ${leads.length} leads from HTML`);
    
    return Array.isArray(leads) ? leads : [];
  } catch (error) {
    logger.error('Failed to extract leads from HTML', { error: error.message });
    return [];
  }
}

