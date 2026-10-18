/** Funnel membership is checked by the caller; stages never hide a free lead. */
export const unassignedLeadVisibleToSalesSql = (leadAlias: string) => `(${leadAlias}.manager_id IS NULL)`;
