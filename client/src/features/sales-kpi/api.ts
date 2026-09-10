import { apiRequest } from '@/lib/queryClient';
import type { CompanySettings } from '@/components/ux/academy/KpiSettingsCard';
import type { KpiConfig, KpiLeadOwnership, KpiOverview, KpiPlanSettings, KpiPlanVersion, KpiRole, KpiSaleReview } from '@shared/sales-kpi';

const root = '/api/academy/sales-kpi';
export const getCompanyTargets = (): Promise<CompanySettings> => apiRequest('GET', '/api/academy/company-settings');
export const saveCompanyTargets = (values: CompanySettings) => apiRequest('PATCH', '/api/academy/company-settings', values);
export const getKpiPlans = (): Promise<KpiPlanSettings> => apiRequest('GET', `${root}/plans`);
export const saveKpiRules = (input: { role: KpiRole; config: KpiConfig; effectiveMonth: string; expectedVersionId: number }): Promise<KpiPlanVersion> => {
  const { role, ...body } = input;
  return apiRequest('POST', `${root}/plans/${role}`, body);
};
export const getKpiOverview = (month: string, managerId: number | null): Promise<KpiOverview> => {
  const params = new URLSearchParams({ month });
  if (managerId) params.set('managerId', String(managerId));
  return apiRequest('GET', `${root}/overview?${params}`);
};
export const getKpiLeadOwnership = (leadId: number): Promise<KpiLeadOwnership> => apiRequest('GET', `${root}/leads/${leadId}`);
export const claimKpiLead = (leadId: number) => apiRequest('POST', `${root}/leads/${leadId}/claim`, {});
export const recordKpiOffer = (leadId: number) => apiRequest('POST', `${root}/leads/${leadId}/offer`, {});
export const reviewKpiPayment = (paymentId: number, input: KpiSaleReview) => apiRequest('PATCH', `${root}/payments/${paymentId}`, input);
