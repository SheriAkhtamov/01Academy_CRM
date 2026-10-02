export interface NotificationDto {
  id: number;
  title: string;
  message: string | null;
  isRead: boolean | null;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
}
export interface NotificationPage {
  items: NotificationDto[];
  total: number;
  nextOffset: number | null;
}
