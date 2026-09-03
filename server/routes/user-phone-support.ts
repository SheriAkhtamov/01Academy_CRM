import type { PoolClient } from 'pg';

type QueryExecutor = Pick<PoolClient, 'query'>;
const maximumUserPhoneNumbers = 10;

export const normalizeUserPhoneNumbers = (
    phoneNumbers: unknown,
    legacyPhone: unknown,
): string[] | undefined => {
    if (phoneNumbers === undefined && legacyPhone === undefined) return undefined;

    const rawPhoneNumbers = phoneNumbers === undefined
        ? legacyPhone === null ? [] : [legacyPhone]
        : phoneNumbers;
    if (!Array.isArray(rawPhoneNumbers) || rawPhoneNumbers.length > maximumUserPhoneNumbers) {
        throw Object.assign(new Error('invalidData'), { statusCode: 400 });
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const value of rawPhoneNumbers) {
        if (typeof value !== 'string') {
            throw Object.assign(new Error('invalidData'), { statusCode: 400 });
        }
        const phone = value.trim();
        if (!phone) continue;
        if (phone.length > 50) {
            throw Object.assign(new Error('invalidData'), { statusCode: 400 });
        }
        const uniqueKey = phone.replace(/\D/g, '') || phone.toLowerCase();
        if (seen.has(uniqueKey)) {
            throw Object.assign(new Error('duplicatePhoneInForm'), { statusCode: 400 });
        }
        seen.add(uniqueKey);
        normalized.push(phone);
    }
    return normalized;
};

export const replaceUserPhones = async (
    executor: QueryExecutor,
    userId: number,
    phoneNumbers: readonly string[],
) => {
    await executor.query('DELETE FROM user_phones WHERE user_id = $1', [userId]);
    if (phoneNumbers.length === 0) return;
    await executor.query(
        `INSERT INTO user_phones (user_id, phone, normalized_phone, sort_order)
         SELECT $1,
                phone,
                regexp_replace(phone, '[^0-9]', '', 'g'),
                sort_order::integer - 1
         FROM UNNEST($2::text[]) WITH ORDINALITY AS phones(phone, sort_order)`,
        [userId, phoneNumbers],
    );
};
