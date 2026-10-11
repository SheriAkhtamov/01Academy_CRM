import { apiRequest } from "@/lib/queryClient";
import { portalDirectoryPageSchema, portalRepresentativePageSchema, type PortalDirectoryQuery } from "@shared/contracts/portal-directory";

const parameters = (query: PortalDirectoryQuery) => {
  const search = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), filter: query.filter, q: query.q });
  if (query.groupId) search.set("groupId", String(query.groupId));
  return search;
};
export const portalDirectoryApi = {
  students: async (query: PortalDirectoryQuery) => portalDirectoryPageSchema.parse(await apiRequest("GET", `/api/lms-management/access-directory?${parameters(query)}`)),
  representatives: async (query: PortalDirectoryQuery) => portalRepresentativePageSchema.parse(await apiRequest("GET", `/api/lms-management/representatives?${parameters(query)}`)),
  export: async (query: PortalDirectoryQuery, locale: "ru" | "en") => {
    const search = parameters(query); search.set("locale", locale);
    const response = await fetch(`/api/lms-management/access-directory/export?${search}`, { credentials: "include", cache: "no-store", headers: { Accept: "text/csv" } });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { code?: string } | null;
      throw new Error(body?.code === "portalDirectoryExportLimit" ? "portalDirectoryExportLimit" : "portalDirectoryExportFailed");
    }
    return response.blob();
  },
};
