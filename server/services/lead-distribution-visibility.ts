/**
 * Unassigned leads remain shared while automatic distribution is disabled.
 * When it is enabled, the first stage of the default funnel is private even
 * if a lead could not be assigned because the eligible roster changed.
 */
export const unassignedLeadVisibleToSalesSql = (leadAlias: string) => `(
  ${leadAlias}.manager_id IS NULL
  AND NOT (
    ${leadAlias}.status_code = 'new_request'
    AND EXISTS (
      SELECT 1
      FROM academy_company_settings distribution_settings
      JOIN academy_sales_funnels distribution_funnel
        ON distribution_funnel.id = ${leadAlias}.funnel_id
      WHERE distribution_settings.auto_lead_distribution_enabled = true
        AND distribution_funnel.is_default = true
    )
  )
)`;
