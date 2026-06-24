export type AccountSwitchLink = {
  ownerUserId: number;
  accountUserId: number;
};

/**
 * A saved-account row represents a trusted link between two accounts. Either
 * participant may switch to the other account, but nobody outside the link
 * can use it.
 */
export function getLinkedAccountId(
  link: AccountSwitchLink,
  currentUserId: number,
): number | null {
  if (link.ownerUserId === currentUserId) {
    return link.accountUserId;
  }

  if (link.accountUserId === currentUserId) {
    return link.ownerUserId;
  }

  return null;
}
