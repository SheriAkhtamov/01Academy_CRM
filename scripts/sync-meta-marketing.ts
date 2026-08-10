import { pool } from '../server/db';
import { syncMetaAdCatalog, syncMetaAdInsights } from '../server/services/meta-marketing';

if (!process.argv.includes('--apply')) {
  throw new Error('Pass --apply to sync the Meta ad catalog and insights');
}

const daysArgumentIndex = process.argv.indexOf('--days');
const requestedDays = Number(daysArgumentIndex >= 0 ? process.argv[daysArgumentIndex + 1] : 120);
const days = Number.isFinite(requestedDays) ? Math.max(1, Math.min(Math.floor(requestedDays), 365)) : 120;

try {
  const catalog = await syncMetaAdCatalog();
  const insights = await syncMetaAdInsights(days);
  const { rows: summaryRows } = await pool.query(
    `SELECT COUNT(*)::int AS insight_rows,
            COALESCE(SUM(spend), 0)::float8 AS spend,
            MAX(currency) AS currency,
            MAX(stat_date) AS latest_stat_date,
            MAX(synced_at) AS latest_synced_at
     FROM meta_ad_insights
     WHERE stat_date >= CURRENT_DATE - ($1::int - 1)`,
    [days],
  );
  const { rows: activeAds } = await pool.query(
    `SELECT ad.ad_id,
            ad.ad_name,
            ad.creative_title,
            COALESCE(SUM(insight.spend), 0)::float8 AS spend,
            COUNT(insight.id)::int AS insight_rows
     FROM meta_ads ad
     LEFT JOIN meta_ad_insights insight
       ON insight.ad_id = ad.ad_id
      AND insight.stat_date >= CURRENT_DATE - ($1::int - 1)
     WHERE ad.effective_status = 'ACTIVE'
     GROUP BY ad.ad_id, ad.ad_name, ad.creative_title
     ORDER BY COALESCE(SUM(insight.spend), 0) DESC, ad.ad_id
     LIMIT 100`,
    [days],
  );
  console.log(JSON.stringify({ days, catalog, insights, summary: summaryRows[0], activeAds }));
} finally {
  await pool.end();
}
