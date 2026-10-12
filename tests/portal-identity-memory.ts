import type { PortalClassification } from "@shared/contracts/portal-identity";
import type {
  PortalAccount,
  PortalAudit,
  PortalConsent,
  PortalInvitation,
  PortalLink,
  PortalRepository,
  PortalSession,
  PortalStudent,
} from "../server/modules/portal-identity/application/ports";

const clone = <T>(value: T): T => structuredClone(value);
export class MemoryPortalRepository implements PortalRepository {
  accounts = new Map<number, PortalAccount>();
  students = new Map<number, PortalStudent>();
  enrollmentGroupIds = new Map<number, number[]>();
  links = new Map<number, PortalLink>();
  consents = new Map<number, PortalConsent>();
  invitations = new Map<number, PortalInvitation>();
  sessions = new Map<string, PortalSession>();
  rates = new Map<string, { count: number; resetAt: number }>();
  audits: PortalAudit[] = [];
  private id = 0;
  private next() {
    return ++this.id;
  }
  async transaction<T>(
    work: (repository: PortalRepository) => Promise<T>,
  ): Promise<T> {
    const snapshot = clone({
      accounts: this.accounts,
      students: this.students,
      enrollmentGroupIds: this.enrollmentGroupIds,
      links: this.links,
      consents: this.consents,
      invitations: this.invitations,
      sessions: this.sessions,
      rates: this.rates,
      audits: this.audits,
      id: this.id,
    });
    try {
      return await work(this);
    } catch (error) {
      Object.assign(this, snapshot);
      throw error;
    }
  }
  async findAccount(identifier: string) {
    return clone(
      [...this.accounts.values()].find(
        (account) =>
          account.login === identifier,
      ) ?? null,
    );
  }
  async findContactMatches(contact: { email: string | null; phone: string | null }, staff: { staffId: number; administration: boolean }) {
    const matches = [...this.accounts.values()].filter((account) => account.status !== "archived" && ((contact.email && account.email === contact.email) || (contact.phone && account.phone?.replace(/\D/g, "") === contact.phone)));
    const visible = matches.filter((account) => staff.administration || [...this.links.values()].some((link) => link.accountId === account.id && link.status !== "revoked" && this.students.get(link.studentId)?.managerId === staff.staffId) || [...this.invitations.values()].some((invite) => invite.accountId === account.id && invite.createdBy === staff.staffId && ["created","sent","delivery_failed","accepted"].includes(invite.status))).slice(0,10);
    return { items: visible.map((account) => ({ id: account.id, login: account.login, fullName: account.fullName, status: account.status as "pending" | "active" | "suspended", matchedBy: [contact.email && account.email === contact.email ? "email" : null, contact.phone && account.phone?.replace(/\D/g, "") === contact.phone ? "phone" : null].filter(Boolean) as ("email" | "phone")[], canUse: account.status === "active" })), additionalMatches: matches.length > visible.length };
  }
  async getAccount(id: number) {
    return clone(this.accounts.get(id) ?? null);
  }
  async createAccount(account: Omit<PortalAccount, "id">) {
    const value = { ...account, id: this.next() };
    this.accounts.set(value.id, clone(value));
    return clone(value);
  }
  async updateAccount(id: number, changes: Partial<Omit<PortalAccount, "id">>) {
    const value = { ...this.accounts.get(id)!, ...changes };
    this.accounts.set(id, clone(value));
    return clone(value);
  }
  async getStudent(id: number) {
    return clone(this.students.get(id) ?? null);
  }
  async getStudentEnrollmentGroupIds(studentId: number) {
    return [...new Set(this.enrollmentGroupIds.get(studentId) ?? [])].sort((left, right) => left - right);
  }
  async updateStudentIdentity(
    id: number,
    classification: PortalClassification,
    birthDate: string | null,
  ) {
    this.students.set(id, {
      ...this.students.get(id)!,
      classification,
      verifiedBirthDate: birthDate,
    });
  }
  async getLink(id: number) {
    return clone(this.links.get(id) ?? null);
  }
  async listLinks(filter: { accountId?: number; studentId?: number }) {
    return clone(
      [...this.links.values()].filter(
        (link) =>
          (!filter.accountId || link.accountId === filter.accountId) &&
          (!filter.studentId || link.studentId === filter.studentId),
      ),
    );
  }
  async createLink(link: Omit<PortalLink, "id">) {
    const value = { ...link, id: this.next() };
    this.links.set(value.id, clone(value));
    return clone(value);
  }
  async updateLink(id: number, changes: Partial<Omit<PortalLink, "id">>) {
    const value = { ...this.links.get(id)!, ...changes };
    this.links.set(id, clone(value));
    return clone(value);
  }
  async getConsents(linkId: number) {
    return clone(
      [...this.consents.values()].filter(
        (consent) => consent.linkId === linkId,
      ),
    );
  }
  async createConsent(consent: Omit<PortalConsent, "id">) {
    const value = { ...consent, id: this.next() };
    this.consents.set(value.id, clone(value));
    return clone(value);
  }
  async revokeConsents(linkId: number, at: number) {
    for (const value of this.consents.values())
      if (value.linkId === linkId && !value.revokedAt) value.revokedAt = at;
  }
  async getInvitationByHash(hash: string) {
    return clone(
      [...this.invitations.values()].find(
        (value) => value.tokenHash === hash,
      ) ?? null,
    );
  }
  async getInvitationByKey(key: string) {
    return clone(
      [...this.invitations.values()].find(
        (value) => value.idempotencyKey === key,
      ) ?? null,
    );
  }
  async listInvitations(linkId: number) {
    return clone(
      [...this.invitations.values()].filter((value) => value.linkId === linkId),
    );
  }
  async createInvitation(invitation: Omit<PortalInvitation, "id">) {
    const value = { ...invitation, id: this.next() };
    this.invitations.set(value.id, clone(value));
    return clone(value);
  }
  async updateInvitation(
    id: number,
    changes: Partial<Omit<PortalInvitation, "id">>,
  ) {
    const value = { ...this.invitations.get(id)!, ...changes };
    this.invitations.set(id, clone(value));
    return clone(value);
  }
  async revokeInvitations(filter: { accountId?: number; linkId?: number }) {
    for (const value of this.invitations.values())
      if (
        (!filter.accountId || value.accountId === filter.accountId) &&
        (!filter.linkId || value.linkId === filter.linkId) &&
        ["created", "sent", "delivery_failed"].includes(value.status)
      )
        value.status = "revoked";
  }
  async getSession(id: string) {
    return clone(this.sessions.get(id) ?? null);
  }
  async saveSession(session: PortalSession) {
    this.sessions.set(session.id, clone(session));
  }
  async touchSession(session: PortalSession) {
    if (!this.sessions.has(session.id)) return false;
    this.sessions.set(session.id, clone(session));
    return true;
  }
  async listSessions(accountId: number) {
    return clone(
      [...this.sessions.values()].filter(
        (value) => value.accountId === accountId,
      ),
    );
  }
  async revokeSessions(accountId: number, exceptId?: string) {
    for (const value of this.sessions.values())
      if (value.accountId === accountId && value.id !== exceptId)
        this.sessions.delete(value.id);
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async rateLimit(key: string, limit: number, windowMs: number, now: number) {
    let value = this.rates.get(key);
    if (!value || value.resetAt <= now) {
      value = { count: 0, resetAt: now + windowMs };
      this.rates.set(key, value);
    }
    value.count++;
    return value.count > limit ? Math.ceil((value.resetAt - now) / 1000) : null;
  }
  async releaseRateLimit(key: string) {
    const value = this.rates.get(key);
    if (value) value.count = Math.max(0, value.count - 1);
  }
  async audit(event: PortalAudit) {
    this.audits.push(clone(event));
  }
}
