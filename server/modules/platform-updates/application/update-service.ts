import type { PlatformUpdate, PublishUpdateCommand, UpdatePublicationResult } from '@shared/contracts/platform-updates';

export interface UpdateRepository {
  list(): Promise<PlatformUpdate[]>;
  find(id: number): Promise<PlatformUpdate | null>;
  publish(command: PublishUpdateCommand, actorId: number | null): Promise<UpdatePublicationResult>;
}
export class PlatformUpdateService {
  constructor(private readonly repository: UpdateRepository,
    private readonly notify: (recipientIds: number[], postId: number) => void) {}
  list() { return this.repository.list(); }
  find(id: number) { return this.repository.find(id); }
  async publish(command: PublishUpdateCommand, actorId: number | null) {
    const result = await this.repository.publish(command, actorId);
    if (result.created && result.recipientIds.length) this.notify(result.recipientIds, result.post.id);
    return result.post;
  }
}
