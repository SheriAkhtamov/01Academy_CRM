export type OnlinePbxLicense = {
  startStamp: number;
  endStamp: number;
  serviceType: string;
  serviceCount: number;
};

export type OnlinePbxLicenseCoverage = Record<string, number>;

export function onlinePbxLicenseCapacity(licenses: readonly OnlinePbxLicense[], type: string, stamp: number) {
  return licenses.filter((license) => license.serviceType === type && license.startStamp <= stamp && license.endStamp >= stamp)
    .reduce((sum, license) => sum + license.serviceCount, 0);
}

/** Paid continuations must replace every service/seat covered by the task.
 * A later payment after a service gap can also settle an overdue task. */
export function isOnlinePbxRenewalPaid(
  licenses: readonly OnlinePbxLicense[], coverage: OnlinePbxLicenseCoverage | null, endStamp: number, now: Date,
) {
  if (!coverage || !Object.keys(coverage).length) return false;
  const stamp = Math.max(endStamp + 1, Math.floor(now.getTime() / 1000));
  return Object.entries(coverage).every(([type, count]) =>
    Number.isSafeInteger(count) && count > 0 && onlinePbxLicenseCapacity(licenses, type, stamp) >= count);
}
