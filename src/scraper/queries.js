/**
 * Smart Selector Queries for Tokko Broker
 * Simple field names - OpenAI will interpret them naturally
 * 
 * Usage: const response = await page.queryElements(QUERY);
 */

// Login page query - https://www.tokkobroker.com/go/
export const LOGIN_QUERY = `
{
  email_input
  password_input
  terms_checkbox
  privacy_checkbox
  login_button
}
`;

// Main navigation query - Sidebar menu
export const NAVIGATION_QUERY = `
{
  oportunidades_link_in_sidebar_menu
}
`;

// Filter dropdown - the button/label that says "Sucursal" to open branch filter
export const OPPORTUNITIES_FILTERS_QUERY = `
{
  sucursal_filter_dropdown_with_text_sucursal
}
`;

// Inside the sucursal dropdown - checkbox or label "Todas las sucursales"
export const SUCURSAL_DROPDOWN_QUERY = `
{
  todas_las_sucursales_checkbox_or_label
}
`;

// Status cards in Oportunidades page
export const STATUS_CARDS_QUERY = `
{
  esperando_respuesta_status_card
  evolucionando_status_card
  tomar_accion_status_card
  congelado_status_card
}
`;

// Leads table - the main table/list containing lead entries
export const LEADS_TABLE_QUERY = `
{
  scrollable_leads_list_container
  individual_lead_entry_rows[]
}
`;

// Date filter 
export const DATE_FILTER_QUERY = `
{
  fecha_de_creacion_filter_dropdown
  aplicar_button
}
`;
