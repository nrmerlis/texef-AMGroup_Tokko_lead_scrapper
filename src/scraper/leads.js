import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import {
  NAVIGATION_QUERY,
  OPPORTUNITIES_FILTERS_QUERY,
  SUCURSAL_DROPDOWN_QUERY,
  LEADS_TABLE_QUERY,
  STATUS_CARDS_QUERY,
  DATE_FILTER_QUERY,
} from './queries.js';

/**
 * Custom error for when the session is closed unexpectedly
 * This happens when another user logs in with the same credentials
 */
export class SessionClosedError extends Error {
  constructor(message = 'Sesión cerrada inesperadamente. Otro usuario se conectó con las mismas credenciales.') {
    super(message);
    this.name = 'SessionClosedError';
    this.isSessionClosed = true;
  }
}

/**
 * Check if the session is still active by verifying we're not on the disconnected page
 * @param {Page} page - Playwright page
 * @throws {SessionClosedError} - If session was closed
 */
async function checkSessionActive(page) {
  const currentUrl = page.url();
  if (currentUrl.includes('/not_connected')) {
    logger.error('Session closed - redirected to /not_connected');
    throw new SessionClosedError();
  }
}

/**
 * Wait for network to be idle with a maximum timeout
 * Tokko keeps connections open, so we can't wait indefinitely
 * @param {Page} page - Playwright page
 * @param {number} maxWait - Maximum time to wait in ms (default 3000)
 */
async function waitForNetworkIdle(page, maxWait = 3000) {
  try {
    await Promise.race([
      page.waitForLoadState('networkidle'),
      new Promise(resolve => setTimeout(resolve, maxWait))
    ]);
  } catch (e) {
    // Re-throw SessionClosedError
    if (e instanceof SessionClosedError) {
      throw e;
    }
    // Ignore other timeout errors
  }
  
  // Always check session after network operations
  await checkSessionActive(page);
}

/**
 * Lead status types matching Tokko Broker UI
 */
export const LEAD_STATUS = {
  ALL: 'all',
  PARA_REASIGNACION: 'para_reasignacion',
  SIN_SEGUIMIENTO: 'sin_seguimiento',
  PENDIENTE_CONTACTAR: 'pendiente_contactar',
  ESPERANDO_RESPUESTA: 'esperando_respuesta',
  EVOLUCIONANDO: 'evolucionando',
  TOMAR_ACCION: 'tomar_accion',
  CONGELADO: 'congelado',
};

/**
 * Navigate to the Oportunidades (Leads) section
 * Uses direct URL navigation for reliability
 * @param {Page} page - Playwright page
 */
export async function navigateToLeads(page) {
  logger.info('Navigating to Oportunidades section via direct URL...');

  try {
    // Navigate directly to leads page - more reliable than clicking sidebar
    await page.goto('https://www.tokkobroker.com/leads/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Check if session was closed during navigation
    await checkSessionActive(page);

    // Wait for the page to fully load
    await waitForNetworkIdle(page);

    // Verify session is still active after network operations
    await checkSessionActive(page);

    logger.info('Navigated to Oportunidades section');
  } catch (error) {
    // Re-throw SessionClosedError as-is
    if (error instanceof SessionClosedError) {
      throw error;
    }
    logger.error('Failed to navigate to Oportunidades', { error: error.message });
    throw error;
  }
}

/**
 * Enable the "Mostrar estados para reasignar" toggle to show all status sections
 * This toggle reveals "Para reasignacion" and "Sin Seguimiento" sections
 * @param {Page} page - Playwright page
 */
export async function enableReassignmentStatesToggle(page) {
  logger.info('Enabling "Mostrar estados para reasignar" toggle...');
  
  try {
    // Wait for page to stabilize
    await waitForNetworkIdle(page);
    
    // The toggle is a circular switch next to the text "Mostrar estados para reasignar"
    // It's located in the top-right area of the page header
    
    // First check if we can see the "Para reasignacion" section already
    const paraReasignacionVisible = await page.locator('text=Para reasignacion').first().isVisible({ timeout: 2000 }).catch(() => false);
    
    if (paraReasignacionVisible) {
      logger.debug('Toggle already enabled - "Para reasignacion" section is visible');
      return;
    }
    
    // Try to click the toggle using JavaScript to find it in the DOM
    let clicked = false;
    
    // Use JavaScript to find and click the toggle
    clicked = await page.evaluate(() => {
      // Find the text "Mostrar estados para reasignar"
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent.includes('Mostrar estados para reasignar')) {
          // Found the text, now look for a toggle/switch nearby
          let parent = node.parentElement;
          for (let i = 0; i < 5; i++) { // Go up 5 levels
            if (!parent) break;
            // Look for toggle elements within this container
            const toggle = parent.querySelector('input[type="checkbox"], [role="switch"], [class*="toggle"], [class*="switch"]');
            if (toggle) {
              toggle.click();
              return true;
            }
            parent = parent.parentElement;
          }
          // If no toggle found, click the parent of the text itself
          if (node.parentElement) {
            node.parentElement.click();
            return true;
          }
        }
      }
      return false;
    });
    
    if (clicked) {
      logger.debug('Clicked toggle via JavaScript');
    }
    
    // Approach 2: Try clicking on any visible switch/toggle element in header area
    if (!clicked) {
      const switchElements = await page.locator('[role="switch"], input[type="checkbox"], [class*="toggle-switch"], [class*="Toggle"], [class*="switch"]').all();
      for (const el of switchElements) {
        const box = await el.boundingBox();
        if (box && box.y < 200) { // In the header area (top 200px)
          await el.click();
          clicked = true;
          logger.debug('Clicked switch element in header');
          break;
        }
      }
    }
    
    if (clicked) {
      // Wait longer for the toggle to take effect
      await waitForNetworkIdle(page);
      await page.waitForTimeout(1000); // Extra wait for UI to update
      
      // Verify the toggle worked by checking if "Para reasignacion" is now visible
      let nowVisible = await page.locator('text=Para reasignacion').first().isVisible({ timeout: 3000 }).catch(() => false);
      
      if (!nowVisible) {
        // Maybe we toggled it off - try clicking again
        logger.debug('First click did not show section, trying again...');
        await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          while (node = walker.nextNode()) {
            if (node.textContent.includes('Mostrar estados para reasignar')) {
              let parent = node.parentElement;
              for (let i = 0; i < 5; i++) {
                if (!parent) break;
                const toggle = parent.querySelector('input[type="checkbox"], [role="switch"], [class*="toggle"], [class*="switch"]');
                if (toggle) {
                  toggle.click();
                  return;
                }
                parent = parent.parentElement;
              }
              if (node.parentElement) node.parentElement.click();
            }
          }
        });
        await waitForNetworkIdle(page);
        await page.waitForTimeout(1000);
        nowVisible = await page.locator('text=Para reasignacion').first().isVisible({ timeout: 3000 }).catch(() => false);
      }
      
      if (nowVisible) {
        logger.info('Toggle "Mostrar estados para reasignar" activated successfully');
      } else {
        logger.warn('Toggle clicked but "Para reasignacion" section not visible');
      }
    } else {
      logger.warn('Could not find toggle to click');
    }
  } catch (error) {
    // Re-throw SessionClosedError - don't swallow it
    if (error instanceof SessionClosedError) {
      throw error;
    }
    logger.error('Failed to enable reassignment states toggle', { error: error.message });
  }
}

/**
 * Apply the "Todas las sucursales" filter to see all leads
 * Uses Playwright text selectors directly - more reliable than LLM for simple clicks
 * @param {Page} page - Playwright page
 */
export async function applyAllBranchesFilter(page) {
  logger.info('Applying "Todas las sucursales" filter...');

  try {
    // Wait for the page to be ready by waiting for filter elements to appear
    // Look for the filter area first (avoid matching menu items like "Sucursales y divisiones")
    await page.waitForLoadState('domcontentloaded');
    await waitForNetworkIdle(page);
    
    // Step 1: Click on the "Sucursal" dropdown
    // The dropdown appears to be a div/button with "Sucursal" text and a chevron
    // Try multiple strategies to find it
    
    // Strategy 1: Look for a dropdown-like element containing exactly "Sucursal"
    let clicked = false;
    
    // Try clicking on element that looks like a dropdown with Sucursal text
    const dropdownSelectors = [
      'div:has-text("Sucursal"):not(:has-text("sucursales"))', // Div with Sucursal but not "sucursales"
      'button:has-text("Sucursal")',
      '[role="combobox"]:has-text("Sucursal")',
      '[role="listbox"]:has-text("Sucursal")',
      'select:has-text("Sucursal")',
    ];
    
    for (const selector of dropdownSelectors) {
      try {
        const dropdown = page.locator(selector).first();
        if (await dropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
          await dropdown.click();
          clicked = true;
          logger.debug(`Clicked Sucursal dropdown using: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Strategy 2: Find by looking at the filter row structure
    if (!clicked) {
      // Look at the filter area - first dropdown in the filters section
      const filterArea = page.locator('.filter, [class*="filter"], [class*="Filter"]').first();
      const sucursalInFilter = filterArea.locator('text=Sucursal').first();
      
      if (await sucursalInFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sucursalInFilter.click();
        clicked = true;
        logger.debug('Clicked Sucursal in filter area');
      }
    }
    
    // Strategy 3: Just click on the text directly
    if (!clicked) {
      await page.click('text=Sucursal', { timeout: 5000 });
      clicked = true;
      logger.debug('Clicked Sucursal text directly');
    }
    
    if (!clicked) {
      logger.warn('Could not find Sucursal dropdown');
      return;
    }
    
    // Step 2: Wait for and click on "Todas las sucursales" option
    const todasOption = page.locator('text=Todas las sucursales').first();
    
    // Wait for the option to be visible (proves dropdown opened)
    if (await todasOption.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
      await todasOption.click();
      logger.debug('Clicked "Todas las sucursales"');
    } else if (await todasOption.isVisible({ timeout: 1000 }).catch(() => false)) {
      await todasOption.click();
      logger.debug('Clicked "Todas las sucursales"');
    } else {
      logger.warn('Could not find "Todas las sucursales" option in dropdown');
    }
    
    // Step 3: Click the "Aplicar" button to apply the filter
    const aplicarBtn = page.locator('text=Aplicar').first();
    
    if (await aplicarBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await aplicarBtn.click();
      logger.debug('Clicked "Aplicar" button');
      
      // Wait for leads to load using network idle (no fixed timeout)
      await waitForNetworkIdle(page);
      logger.info('Filter "Todas las sucursales" applied successfully');
    } else {
      logger.warn('Could not find "Aplicar" button');
    }
  } catch (error) {
    // Re-throw SessionClosedError - don't swallow it
    if (error instanceof SessionClosedError) {
      throw error;
    }
    logger.error('Failed to apply branch filter', { error: error.message });
  }
}

/**
 * Log status filter info
 * Note: Actual filtering is done in scrapeVisibleLeads by reading section headers
 * The status cards in Tokko don't filter - they're just section headers
 * @param {Page} page - Playwright page
 * @param {string} status - Status type to filter by
 */
export async function filterByStatus(page, status) {
  if (status === LEAD_STATUS.ALL || !status) {
    logger.info('No status filter - will scrape all sections');
    return;
  }

  // Validate status is known
  const validStatuses = Object.values(LEAD_STATUS);
  if (!validStatuses.includes(status)) {
    logger.warn(`Unknown status: ${status}. Valid statuses: ${validStatuses.join(', ')}`);
    return;
  }

  logger.info(`Will filter leads by section: ${status}`);
  // Actual filtering happens in scrapeVisibleLeads by detecting section headers
}

/**
 * Parse a date string to Date object
 * Handles common Spanish date formats from Tokko
 * @param {string} dateStr - Date string from the page
 * @returns {Date|null}
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  const now = new Date();
  const cleanStr = dateStr.trim().toLowerCase();

  // Handle relative dates like "8 años 182 días"
  if (cleanStr.includes('año') || cleanStr.includes('día') || cleanStr.includes('mes')) {
    let totalDays = 0;

    const yearsMatch = cleanStr.match(/(\d+)\s*años?/);
    if (yearsMatch) {
      totalDays += parseInt(yearsMatch[1], 10) * 365;
    }

    const monthsMatch = cleanStr.match(/(\d+)\s*mes(es)?/);
    if (monthsMatch) {
      totalDays += parseInt(monthsMatch[1], 10) * 30;
    }

    const daysMatch = cleanStr.match(/(\d+)\s*días?/);
    if (daysMatch) {
      totalDays += parseInt(daysMatch[1], 10);
    }

    if (totalDays > 0) {
      const date = new Date(now);
      date.setDate(date.getDate() - totalDays);
      return date;
    }
  }

  // Handle "hace X horas/minutos"
  if (cleanStr.includes('hace')) {
    const hoursMatch = cleanStr.match(/hace\s*(\d+)\s*hora/);
    if (hoursMatch) {
      const date = new Date(now);
      date.setHours(date.getHours() - parseInt(hoursMatch[1], 10));
      return date;
    }

    const minutesMatch = cleanStr.match(/hace\s*(\d+)\s*minuto/);
    if (minutesMatch) {
      const date = new Date(now);
      date.setMinutes(date.getMinutes() - parseInt(minutesMatch[1], 10));
      return date;
    }
  }

  // Try standard date formats
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try DD/MM/YYYY format (common in Spanish)
  const ddmmyyyy = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ddmmyyyy) {
    return new Date(ddmmyyyy[3], ddmmyyyy[2] - 1, ddmmyyyy[1]);
  }

  return null;
}

/**
 * Extract text content safely from an element
 * @param {Object} element - Page element
 * @returns {Promise<string|null>}
 */
async function getText(element) {
  if (!element) return null;
  try {
    return await element.textContent();
  } catch {
    return null;
  }
}

/**
 * Extract lead data from a table row
 * @param {Object} row - Lead row element
 * @returns {Promise<Object>} - Parsed lead data
 */
async function extractLeadData(row) {
  return {
    contactName: await getText(row.contact_name),
    contactInfo: await getText(row.contact_info),
    propertyName: await getText(row.property_name),
    propertyType: await getText(row.property_type),
    vigencia: await getText(row.vigencia_date),
    notesCount: await getText(row.notes_count),
    lastUpdated: await getText(row.last_updated_date),
    status: await getText(row.status_badge),
  };
}

/**
 * Get a unique identifier for a lead to avoid duplicates
 * @param {Object} lead - Lead object
 * @returns {string} - Unique key
 */
function getLeadKey(lead) {
  return `${lead.contactName || ''}-${lead.propertyName || ''}-${lead.vigencia || ''}`.toLowerCase();
}

/**
 * Status section header texts in Tokko UI
 */
const STATUS_SECTION_HEADERS = {
  'para_reasignacion': 'Para reasignacion',
  'sin_seguimiento': 'Sin Seguimiento',
  'pendiente_contactar': 'Pendiente contactar',
  'esperando_respuesta': 'Esperando respuesta',
  'evolucionando': 'Evolucionando',
  'tomar_accion': 'Tomar Accion',
  'congelado': 'Congelado',
};

/**
 * Extract leads data directly from page using Playwright selectors
 * More reliable than LLM for structured table data
 * @param {Page} page - Playwright page
 * @param {string} targetStatus - Optional: filter leads by status section
 * @returns {Promise<Array>} - Array of lead objects
 */
async function scrapeVisibleLeads(page, targetStatus = null) {
  try {
    // Check session before scraping
    await checkSessionActive(page);

    const leads = [];
    
    // Wait for leads table to be visible
    await page.waitForSelector('tr, [class*="row"]', { state: 'visible', timeout: 5000 }).catch(() => {});
    
    // Check session after waiting
    await checkSessionActive(page);

    // Get ALL table rows (both section headers and lead rows)
    const allRows = await page.locator('tr').all();
    
    let inTargetSection = targetStatus === 'all' || !targetStatus;
    let targetSectionHeader = targetStatus ? STATUS_SECTION_HEADERS[targetStatus] : null;
    
    for (const row of allRows) {
      try {
        const text = await row.textContent();
        
        // Check if this is a section header row (contains status name and count like "Pendiente contactar (15)")
        const isSectionHeader = Object.values(STATUS_SECTION_HEADERS).some(header => 
          text.includes(header) && /\(\d+\)/.test(text)
        );
        
        if (isSectionHeader) {
          logger.debug(`Found section header: "${text.trim().substring(0, 80).replace(/\n/g, ' ')}"`);
          // Check if we're entering or leaving our target section
          if (targetSectionHeader) {
            if (text.includes(targetSectionHeader)) {
              inTargetSection = true;
              logger.debug(`Entering target section: ${targetSectionHeader}`);
              continue;
            } else if (inTargetSection && targetStatus !== 'all') {
              // We were in target section and found a different header - stop
              logger.debug(`Leaving target section, found: ${text.substring(0, 50)}`);
              break;
            }
          }
          continue; // Skip header rows
        }
        
        // Only process lead rows if we're in the target section
        if (!inTargetSection) {
          continue;
        }
        
        // Parse the row text to extract lead info
        const lead = parseLeadFromText(text);
        if (lead && lead.contactName) {
          leads.push(lead);
        }
      } catch (e) {
        // Re-throw SessionClosedError, ignore other errors
        if (e instanceof SessionClosedError) {
          throw e;
        }
        continue;
      }
    }
    
    // If no leads found with direct parsing, try LLM extraction
    if (leads.length === 0) {
      logger.debug('No leads found with Playwright selectors, trying LLM extraction...');
      const html = await page.content();
      const { extractLeadsFromHTML } = await import('./smart-selector.js');
      const llmLeads = await extractLeadsFromHTML(html);
      if (llmLeads && llmLeads.length > 0) {
        return llmLeads;
      }
    }

    logger.debug(`Found ${leads.length} visible leads in section "${targetStatus || 'all'}"`);
    return leads;
  } catch (error) {
    // Re-throw SessionClosedError - don't swallow it
    if (error instanceof SessionClosedError) {
      throw error;
    }
    logger.error('Error scraping visible leads', { error: error.message });
    return [];
  }
}

/**
 * Extract contact details by clicking on the contact name and reading the tooltip/popover
 * @param {Page} page - Playwright page
 * @param {Object} lead - Lead object with contactName
 * @param {number} index - Index for logging
 * @returns {Promise<Object>} - Contact info with email, phone, cellPhone
 */
async function extractContactDetails(page, lead, index) {
  try {
    // Check session before extracting
    await checkSessionActive(page);

    const contactName = lead.contactName?.trim();
    if (!contactName) {
      logger.debug(`No contact name for lead ${index + 1}`);
      return { email: null, phone: null, cellPhone: null };
    }

    // The contact is in a div with class "class_contact_tooltip" inside a td with class "leads-contact-td"
    // Structure: <td class="leads-contact-td"><div class="class_contact_tooltip">Name (Agent)</div></td>
    const contactElement = page.locator(`.class_contact_tooltip:has-text("${contactName}")`).first();
    
    // Scroll to the element first
    try {
      await contactElement.scrollIntoViewIfNeeded({ timeout: 3000 });
      await page.waitForTimeout(200);
    } catch (e) {
      // Element might not exist
    }

    if (await contactElement.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Click on the contact name to open tooltip/popover
      await contactElement.click();
      
      let email = null;
      let phone = null;
      let cellPhone = null;

      try {
        // Wait for the qTip tooltip to appear
        // Tokko uses qTip (jQuery UI Tooltip) with class "contact_ttip" or "ui-tooltip"
        await page.waitForTimeout(800);
        
        // The tooltip uses qTip - look for .ui-tooltip, .qtip, or .contact_ttip
        const popoverSelectors = [
          '.contact_ttip',
          '.ui-tooltip.qtip',
          '.ui-tooltip',
          '.qtip',
        ];
        
        let popoverText = '';
        
        // Try to find the qTip tooltip content
        for (const selector of popoverSelectors) {
          const popover = page.locator(selector).first();
          if (await popover.isVisible({ timeout: 500 }).catch(() => false)) {
            popoverText = await popover.innerText().catch(() => '');
            if (popoverText && (popoverText.includes('@') || popoverText.includes('+'))) {
              logger.debug(`Found qTip tooltip with selector: ${selector}`);
              break;
            }
          }
        }
        
        // Fallback: look for any floating element with contact info
        if (!popoverText) {
          popoverText = await page.evaluate(() => {
            const elements = document.querySelectorAll('.ui-tooltip, .qtip, [class*="tooltip"]');
            for (const el of elements) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                const text = el.innerText || '';
                if ((text.includes('@') && text.includes('.')) || text.includes('+54')) {
                  return text;
                }
              }
            }
            return '';
          });
        }
        
        if (popoverText) {
          logger.debug(`Popover text for ${contactName}: ${popoverText.substring(0, 100)}`);
          
          // Extract email - look for pattern like email@domain.com
          const emailMatch = popoverText.match(/[\w.-]+@[\w.-]+\.\w+/);
          if (emailMatch) {
            email = emailMatch[0].trim();
          }
          
          // Extract phones - look for patterns with + or digits
          // Argentine phone formats:
          // - Landline: +54 XXX XXXXXXX (no 9 after country code)
          // - Cell: +549 XXX XXXXXXX (has 9 after country code 54)
          const phoneMatches = popoverText.match(/\+?\d[\d\s()-]{8,}/g) || [];
          
          for (const phoneMatch of phoneMatches) {
            const cleanPhone = phoneMatch.replace(/[^+\d]/g, '');
            
            // Check if it's a cell phone: has "549" pattern (54 + 9 for mobile)
            // The 9 must come right after 54 to be a cell phone
            const isCellPhone = /^\+?549/.test(cleanPhone);
            
            if (isCellPhone) {
              if (!cellPhone) cellPhone = cleanPhone;
            } else {
              if (!phone) phone = cleanPhone;
            }
          }
          
          logger.debug(`Extracted contact info for ${contactName}:`, { email, phone, cellPhone });
        } else {
          logger.debug(`No popover text found for ${contactName}`);
        }
        
      } catch (popoverError) {
        logger.debug(`Could not extract contact info: ${popoverError.message}`);
      }
      
      // Close the popover by pressing Escape or clicking outside
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      
      return { email, phone, cellPhone };
    }
    
    logger.debug(`Contact element not visible for: ${contactName}`);
    return { email: null, phone: null, cellPhone: null };
  } catch (error) {
    // Re-throw SessionClosedError - don't swallow it
    if (error instanceof SessionClosedError) {
      throw error;
    }
    logger.error(`Error extracting contact details for lead ${index + 1}`, { error: error.message });
    return { email: null, phone: null, cellPhone: null };
  }
}

/**
 * Extract property details by clicking on the property link and reading the modal
 * @param {Page} page - Playwright page
 * @param {Object} lead - Lead object with propertyAddress
 * @param {number} index - Index for logging
 * @returns {Promise<Object>} - Lead with added propertyId and propertyAgent
 */
async function extractPropertyDetails(page, lead, index) {
  try {
    // Check session before extracting
    await checkSessionActive(page);
    
    // Find the property link by matching the address text
    const propertyAddress = lead.propertyAddress?.replace(/\s*\+\s*$/, '').trim();
    if (!propertyAddress || propertyAddress === '+') {
      logger.debug(`No valid property address for lead ${index + 1}`);
      return lead;
    }
    
    // Find and click on the property link
    const propertyLink = page.locator(`a:has-text("${propertyAddress}")`).first();
    
    // Scroll to the link first to make sure it's in viewport
    try {
      await propertyLink.scrollIntoViewIfNeeded({ timeout: 3000 });
      await page.waitForTimeout(300);
    } catch (e) {
      // Link might not exist
    }
    
    if (await propertyLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Click on the property link
      await propertyLink.click();
      
      let propertyId = null;
      let propertyAgent = null;
      
      try {
        // Wait for modal to be visible
        // If modal doesn't appear, it means an editable input appeared instead (no real property)
        await page.waitForSelector('#quickDisplay_modal', { state: 'visible', timeout: 2000 });
        
        // Get text from modal - content is usually in an iframe
        let modalText = '';
        const maxAttempts = 10;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          // First check if content is directly in modal
          modalText = await page.locator('#quickDisplay_modal').innerText();
          
          // If content is short, it's probably in an iframe
          if (modalText.length < 50) {
            const modalHTML = await page.locator('#quickDisplay_modal').innerHTML();
            if (modalHTML.includes('<iframe')) {
              const frame = page.frameLocator('#quickDisplay_modal iframe').first();
              modalText = await frame.locator('body').innerText().catch(() => '');
            }
          }
          
          // Check if we have the content we need (contains "Disponible" which indicates loaded)
          if (modalText.includes('Disponible') || modalText.includes('Agente')) {
            break; // Content loaded successfully
          }
          
          // Wait a bit and retry (200ms * 10 = max 2 seconds, but usually faster)
          if (attempt < maxAttempts - 1) {
            await page.waitForTimeout(200);
          }
        }
        
        // Extract property ID - format: "Disponible AAP7427642 | Departamento" or "Disponible APH6732280 | PH"
        // Extract text between "Disponible" and "|"
        const idMatch = modalText.match(/Disponible\s+([A-Z]{2,4}\d+)\s*\|/i);
        if (idMatch) {
          propertyId = idMatch[1].trim();
        }
        
        // Extract agent name
        const agentMatch = modalText.match(/Agente\s*\n?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]+?)(?:\s*\n|\s*Contactar|$)/i);
        if (agentMatch) {
          propertyAgent = agentMatch[1].trim().split('\n')[0].trim();
          if (propertyAgent.length < 2 || 
              propertyAgent.toLowerCase().includes('contactar') ||
              propertyAgent.toLowerCase().includes('información')) {
            propertyAgent = null;
          }
        }
        
      } catch (modalError) {
        // Modal didn't appear - might be an editable field case we didn't catch
        logger.debug(`No modal appeared for property "${propertyAddress}" - lead ${index + 1}`);
      }
      
      // Close the modal or any open element
      await page.keyboard.press('Escape');
      
      // Wait for modal to close completely
      try {
        await page.waitForSelector('#quickDisplay_modal', { state: 'hidden', timeout: 2000 });
      } catch (e) {
        // Force close by clicking outside
        await page.mouse.click(10, 10);
        await page.waitForSelector('#quickDisplay_modal', { state: 'hidden', timeout: 2000 }).catch(() => {});
      }
      
      return {
        ...lead,
        propertyId,
        propertyAgent: propertyAgent || lead._agentName
      };
    } else {
      return lead;
    }
  } catch (error) {
    // Re-throw SessionClosedError - don't swallow it
    if (error instanceof SessionClosedError) {
      throw error;
    }
    logger.error(`Error extracting property details for lead ${index + 1}`, { error: error.message });
    return lead;
  }
}

/**
 * Scrape leads with optional property details extraction
 * @param {Page} page - Playwright page
 * @param {boolean} extractDetails - Whether to click each property to get ID and agent
 * @param {string} targetStatus - Optional: filter leads by status section
 * @returns {Promise<Array>} - Array of lead objects with optional property details
 */
async function scrapeVisibleLeadsWithDetails(page, extractDetails = false, targetStatus = null) {
  const leads = await scrapeVisibleLeads(page, targetStatus);
  
  if (!extractDetails || leads.length === 0) {
    return leads;
  }
  
  logger.info(`Extracting property details for ${leads.length} leads...`);
  
  const leadsWithDetails = [];
  for (let i = 0; i < leads.length; i++) {
    const leadWithDetails = await extractPropertyDetails(page, leads[i], i);
    leadsWithDetails.push(leadWithDetails);
    // No delay needed - modal loading already provides natural pacing
  }
  
  return leadsWithDetails;
}

/**
 * Parse lead data from raw row text
 * @param {string} text - Raw text from a table row
 * @returns {Object|null} - Lead object or null
 */
function parseLeadFromText(text) {
  if (!text) return null;
  
  // Clean up whitespace
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  // Try to extract: "ContactName (AgentName) PropertyAddress DD/MM/YYYY HH:MM"
  // Pattern: Look for name with parentheses, then address, then date
  
  // Extract date pattern DD/MM/YYYY HH:MM
  const dateMatch = cleanText.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/);
  const lastUpdated = dateMatch ? dateMatch[1] : null;
  
  // Extract contact name with agent in parentheses: "Name (Agent)"
  const contactMatch = cleanText.match(/^([^(]+)\s*\(([^)]+)\)/);
  let contactName = null;
  let agentName = null;
  
  if (contactMatch) {
    contactName = contactMatch[1].trim();
    agentName = contactMatch[2].trim();
  }
  
  // Extract property address - text between agent name and date
  let propertyAddress = null;
  if (contactMatch && dateMatch) {
    const afterAgent = cleanText.indexOf(')') + 1;
    const beforeDate = cleanText.indexOf(dateMatch[1]);
    if (afterAgent > 0 && beforeDate > afterAgent) {
      propertyAddress = cleanText.substring(afterAgent, beforeDate).trim();
      // Clean up common prefixes
      propertyAddress = propertyAddress.replace(/^[\s@]+/, '').trim();
    }
  }
  
  // Only return if we have at least contact name
  if (!contactName) return null;
  
  return {
    contactName,
    propertyAddress,
    lastUpdated,
    status: null,
    // agentName stored internally for fallback
    _agentName: agentName
  };
}

/**
 * Scroll within a specific container element (for scrollable divs)
 * @param {Page} page - Playwright page
 * @param {string} containerSelector - CSS selector for the scrollable container
 * @returns {Promise<Object>} - Scroll result info
 */
async function scrollContainer(page, containerSelector = null) {
  // Check session before scrolling
  await checkSessionActive(page);

  const scrolled = await page.evaluate((selector) => {
    const possibleContainers = selector 
      ? [document.querySelector(selector)]
      : [
          document.querySelector('[class*="scroll"]'),
          document.querySelector('[class*="list"]'),
          document.querySelector('[class*="table-container"]'),
          document.querySelector('[class*="content"]'),
          document.querySelector('main'),
          document.body,
        ];
    
    for (const container of possibleContainers) {
      if (container && container.scrollHeight > container.clientHeight) {
        const previousScroll = container.scrollTop;
        container.scrollTop = container.scrollHeight;
        return {
          scrolled: true,
          previousScroll,
          newScroll: container.scrollTop,
          maxScroll: container.scrollHeight - container.clientHeight
        };
      }
    }
    
    const previousScroll = window.scrollY;
    window.scrollTo(0, document.body.scrollHeight);
    return {
      scrolled: true,
      previousScroll,
      newScroll: window.scrollY,
      maxScroll: document.body.scrollHeight - window.innerHeight
    };
  }, containerSelector);

  // Wait for any lazy-loaded content after scroll
  await waitForNetworkIdle(page);

  // Check session after network operations
  await checkSessionActive(page);

  return scrolled;
}

/**
 * Apply date filter on the Oportunidades page
 * @param {Page} page - Playwright page
 * @param {Date} startDate - Filter start date
 * @param {Date} endDate - Filter end date
 */
export async function applyDateFilter(page, startDate, endDate) {
  logger.info('Applying date filter...', {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  });

  try {
    const filters = await page.queryElements(OPPORTUNITIES_FILTERS_QUERY);

    if (filters.filters_section?.fecha_creacion_dropdown) {
      await filters.filters_section.fecha_creacion_dropdown.click();
      // Wait for date filter options to appear
      await waitForNetworkIdle(page);

      const dateFilter = await page.queryElements(DATE_FILTER_QUERY);

      if (dateFilter.date_filter?.date_range_selector) {
        const { date_range_selector } = dateFilter.date_filter;

        const formatDate = (date) => {
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const year = date.getFullYear();
          return `${day}/${month}/${year}`;
        };

        if (date_range_selector.start_date_input) {
          await date_range_selector.start_date_input.fill(formatDate(startDate));
        }

        if (date_range_selector.end_date_input) {
          await date_range_selector.end_date_input.fill(formatDate(endDate));
        }

        if (dateFilter.date_filter.apply_button) {
          await dateFilter.date_filter.apply_button.click();
          await waitForNetworkIdle(page);
        }

        logger.info('Date filter applied successfully');
      }
    } else {
      logger.warn('Date filter dropdown not found');
    }
  } catch (error) {
    // Re-throw SessionClosedError - don't swallow it
    if (error instanceof SessionClosedError) {
      throw error;
    }
    logger.error('Failed to apply date filter', { error: error.message });
  }
}

/**
 * Main function: Scrape all leads with infinite scroll until target date
 * @param {Page} page - Playwright page
 * @param {Date} targetDate - Stop scraping when leads are older than this
 * @param {Object} options - Additional options
 * @param {string} options.status - Filter by lead status (default: 'all')
 * @param {number} options.maxScrolls - Maximum scroll attempts (default: 200)
 * @param {number} options.maxLeads - Maximum leads to collect (default: 10000)
 * @returns {Promise<Array>} - Array of all scraped leads
 */
export async function scrapeLeadsUntilDate(page, targetDate, options = {}) {
  const { 
    status = LEAD_STATUS.ALL,
    maxScrolls = 200, 
    maxLeads = 10000,
    extractDetails = false
  } = options;
  
  const allLeads = new Map();
  let scrollCount = 0;
  let noNewLeadsCount = 0;
  let reachedTargetDate = false;

  logger.info('Starting infinite scroll lead scraping...', {
    targetDate: targetDate.toISOString(),
    status,
    maxScrolls,
    maxLeads,
    extractDetails,
  });

  // Step 1: Apply the "Todas las sucursales" filter first
  await applyAllBranchesFilter(page);

  // Step 2: Handle "Mostrar estados para reasignar" toggle
  // This toggle shows "Para reasignacion" and "Sin Seguimiento" sections when enabled
  // Other sections (Pendiente contactar, Esperando respuesta, etc.) show when disabled
  const needsToggleEnabled = status === 'para_reasignacion' || status === 'sin_seguimiento';
  if (needsToggleEnabled) {
    await enableReassignmentStatesToggle(page);
  } else {
    logger.debug(`Status "${status}" does not need toggle - skipping`);
  }

  // Step 3: Log status filter info
  await filterByStatus(page, status);

  // Wait for results to load
  await waitForNetworkIdle(page);

  // Scroll to absolute top of page and table to ensure first sections are visible
  await page.evaluate(() => {
    // Scroll main window to top
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    
    // Try to find and scroll any scrollable table container
    const containers = document.querySelectorAll('[class*="scroll"], [class*="table"], [class*="list"], [style*="overflow"]');
    containers.forEach(c => {
      if (c.scrollTop !== undefined) {
        c.scrollTop = 0;
      }
    });
  });
  await waitForNetworkIdle(page);

  while (
    scrollCount < maxScrolls &&
    allLeads.size < maxLeads &&
    noNewLeadsCount < 5 &&
    !reachedTargetDate
  ) {
    // Check session is still active at the start of each iteration
    await checkSessionActive(page);

    const previousCount = allLeads.size;

    // First, scrape basic lead info (fast, no modal) - filter by status section
    const visibleLeads = await scrapeVisibleLeads(page, status);
    
    // Filter leads by date BEFORE extracting details
    const leadsToProcess = [];
    for (const lead of visibleLeads) {
      const key = getLeadKey(lead);
      if (allLeads.has(key)) continue;

      const leadDateStr = lead.vigencia || lead.lastUpdated;
      const leadDate = parseDate(leadDateStr);

      if (leadDate && leadDate < targetDate) {
        logger.info('Reached target date, stopping scraping', {
          lastLeadDate: leadDateStr,
          parsedDate: leadDate?.toISOString(),
          targetDate: targetDate.toISOString(),
        });
        reachedTargetDate = true;
        break;
      }
      
      leadsToProcess.push({ lead, key, leadDate });
    }
    
    // Now extract property and contact details only for leads within date range
    logger.info(`Processing ${leadsToProcess.length} leads, extractDetails: ${extractDetails}`);
    
    for (const { lead, key, leadDate } of leadsToProcess) {
      // Check maxLeads limit
      if (allLeads.size >= maxLeads) {
        logger.info(`Reached maxLeads limit: ${maxLeads}`);
        break;
      }
      
      let propertyId = null;
      let propertyAgent = null;
      let contactInfo = { email: null, phone: null, cellPhone: null };
      
      if (extractDetails) {
        logger.info(`Extracting details for: ${lead.contactName}`);
        
        // Extract property details
        const leadWithProperty = await extractPropertyDetails(page, lead, allLeads.size);
        propertyId = leadWithProperty.propertyId;
        propertyAgent = leadWithProperty.propertyAgent;
        
        // Extract contact details (email, phones)
        contactInfo = await extractContactDetails(page, lead, allLeads.size);
        
        logger.info(`Extracted - propertyId: ${propertyId}, agent: ${propertyAgent}, email: ${contactInfo.email}`);
      }

      // Structure the lead data with organized sections
      const structuredLead = {
        // Contact info section
        contact: {
          name: lead.contactName || null,
          email: contactInfo.email,
          phone: contactInfo.phone,
          cellPhone: contactInfo.cellPhone,
        },
        // Agent info section
        agent: {
          name: propertyAgent || lead._agentName || null,
        },
        // Property info section
        property: {
          id: propertyId,
          address: lead.propertyAddress || null,
        },
        // Metadata
        lastUpdated: lead.lastUpdated || null,
        scrapedAt: new Date().toISOString(),
      };
      
      allLeads.set(key, structuredLead);
    }

    if (reachedTargetDate) break;

    const newLeadsFound = allLeads.size - previousCount;
    if (newLeadsFound === 0) {
      noNewLeadsCount++;
      logger.debug(`No new leads found (attempt ${noNewLeadsCount}/5)`);
    } else {
      noNewLeadsCount = 0;
      logger.info(`Found ${newLeadsFound} new leads, total: ${allLeads.size}`);
    }

    scrollCount++;
    logger.debug(`Scrolling... (${scrollCount}/${maxScrolls})`);

    const scrollResult = await scrollContainer(page);
    
    if (scrollResult.newScroll >= scrollResult.maxScroll * 0.99) {
      // Reached end of scroll, wait for any final content to load
      await waitForNetworkIdle(page);
      const finalLeads = await scrapeVisibleLeads(page, status);
      
      for (const lead of finalLeads) {
        const key = getLeadKey(lead);
        if (!allLeads.has(key)) {
          const leadDate = parseDate(lead.vigencia || lead.lastUpdated);
          if (!leadDate || leadDate >= targetDate) {
            // Structure the lead data (without full details extraction at end of scroll)
            const structuredLead = {
              contact: {
                name: lead.contactName || null,
                email: null,
                phone: null,
                cellPhone: null,
              },
              agent: {
                name: lead._agentName || null,
              },
              property: {
                id: null,
                address: lead.propertyAddress || null,
              },
              lastUpdated: lead.lastUpdated || null,
              scrapedAt: new Date().toISOString(),
            };
            allLeads.set(key, structuredLead);
          }
        }
      }
      
      logger.info('Reached end of scroll');
      break;
    }
  }

  const leadsArray = Array.from(allLeads.values());

  logger.info('Lead scraping completed', {
    totalLeads: leadsArray.length,
    scrollAttempts: scrollCount,
    status,
    reachedTargetDate,
  });

  return leadsArray;
}
