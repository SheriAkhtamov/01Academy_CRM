import type { OnlinePbxExtension, OnlinePbxLicense } from './onlinepbx';
import { reconcileOnlinePbxLicenseIssue } from '../storage/onlinepbx-license-tasks';
import { publishRealtimeEvent } from '../realtime/realtime-hub';
import { t } from '../lib/i18n';

export async function processOnlinePbxLicenseIssues(
  domain: string, requiredExtensions: readonly string[], recipients: readonly number[],
  extensions: readonly OnlinePbxExtension[], licenses: readonly OnlinePbxLicense[], now: Date,
) {
  const stamp = Math.floor(now.getTime() / 1000);
  const paidSeats = licenses.filter((license) => license.serviceType === 'USER' && license.startStamp <= stamp && license.endStamp >= stamp)
    .reduce((sum, license) => sum + license.serviceCount, 0);
  for (const extension of requiredExtensions) {
    const user = extensions.find((candidate) => candidate.extension === extension);
    // Do not resolve an existing outage based on an incomplete provider response.
    if (!user) continue;
    const needsLicense = !user.enabled && paidSeats < requiredExtensions.length;
    for (const userId of recipients) {
      const result = await reconcileOnlinePbxLicenseIssue({
        domain, extension, userId, needsLicense,
        title: t('onlinePbxLicenseActivationTaskTitle', { extension }),
        description: t('onlinePbxLicenseActivationTaskDescription', { domain, extension }),
      }, now);
      if (result.created && result.task) publishRealtimeEvent({ type: 'BOARD_TASK_CREATED', data: { id: result.task.id, boardId: result.task.boardId } });
    }
  }
}
