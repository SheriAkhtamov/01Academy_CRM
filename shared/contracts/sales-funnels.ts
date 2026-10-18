export type SalesFunnelTransferOption = {
  id: number;
  name: string;
  initialStageCode: string | null;
  stages: Array<{ code: string; name: string }>;
};
