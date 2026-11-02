import type {
  FutureGroupInput,
  FutureGroupParty,
} from "@shared/contracts/future-groups";
import type { ActorContext } from "../../leads/domain/actor-context";

export interface FutureGroupsStore {
  list(): Promise<unknown>;
  save(
    actor: ActorContext,
    input: FutureGroupInput,
    id?: number,
  ): Promise<unknown>;
  candidates(actor: ActorContext, search: string): Promise<unknown>;
  members(actor: ActorContext, id: number): Promise<unknown>;
  changeMember(
    actor: ActorContext,
    id: number,
    party: FutureGroupParty,
    remove: boolean,
  ): Promise<unknown>;
  archive(actor: ActorContext, id: number): Promise<unknown>;
}

export function createFutureGroupsService(store: FutureGroupsStore) {
  const authorize = (actor: ActorContext) => {
    if (
      !actor.userId ||
      (!actor.isLeadership && !actor.modules.includes("sales"))
    ) {
      throw Object.assign(new Error("accessDenied"), { statusCode: 403 });
    }
  };
  return {
    list(actor: ActorContext) {
      authorize(actor);
      return store.list();
    },
    save(actor: ActorContext, input: FutureGroupInput, id?: number) {
      authorize(actor);
      return store.save(actor, input, id);
    },
    candidates(actor: ActorContext, search: string) {
      authorize(actor);
      return store.candidates(actor, search);
    },
    members(actor: ActorContext, id: number) {
      authorize(actor);
      return store.members(actor, id);
    },
    changeMember(
      actor: ActorContext,
      id: number,
      party: FutureGroupParty,
      remove: boolean,
    ) {
      authorize(actor);
      return store.changeMember(actor, id, party, remove);
    },
    archive(actor: ActorContext, id: number) {
      authorize(actor);
      return store.archive(actor, id);
    },
  };
}
export type FutureGroupsService = ReturnType<typeof createFutureGroupsService>;
