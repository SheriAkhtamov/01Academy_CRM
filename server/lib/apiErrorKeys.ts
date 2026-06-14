const normalizeText = (message: string) => message.trim().replace(/^\d+:\s*/, "");

export const toApiErrorKey = (message: string) => {
    const normalized = normalizeText(message);

    if (!normalized) {
        return 'errorOccurred';
    }

    const lower = normalized.toLowerCase();

    if (lower === 'unauthorized' || lower.includes('invalid or inactive user')) {
        return 'unauthorized';
    }
    if (lower.includes('authentication required')) {
        return 'authenticationRequired';
    }
    if (lower.includes('admin access required') || lower.includes('administrator privileges required')) {
        return 'adminAccessRequired';
    }
    if (lower.includes('sales access required')) {
        return 'salesAccessRequired';
    }
    if (lower.includes('report access required')) {
        return 'reportAccessRequired';
    }
    if (lower.includes('invalid credentials')) {
        return 'invalidCredentialsMessage';
    }
    if (lower.includes('access denied') || lower.includes('forbidden')) {
        return 'accessDenied';
    }
    if (lower.includes('session save failed')) {
        return 'sessionSaveFailed';
    }
    if (lower.includes('required') || lower.includes('missing required') || lower.includes('no documents uploaded')) {
        return 'fillRequiredFields';
    }
    if (lower.startsWith('invalid ')) {
        return 'invalidData';
    }
    if (lower.includes('not found')) {
        return 'resourceNotFound';
    }
    if (lower.startsWith('failed to fetch') || lower.startsWith('failed to resolve') || lower.startsWith('failed to load')) {
        return 'failedToLoadData';
    }
    if (lower.startsWith('failed to create')) {
        return 'failedToCreateResource';
    }
    if (lower.startsWith('failed to update')) {
        return 'failedToUpdateResource';
    }
    if (lower.startsWith('failed to delete')) {
        return 'failedToDeleteResource';
    }
    if (lower.startsWith('failed to upload')) {
        return 'failedToUploadResource';
    }

    return normalized;
};
