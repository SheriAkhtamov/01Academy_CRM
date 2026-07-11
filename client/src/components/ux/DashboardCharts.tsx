import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
  Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';
import { buildMonthlyRevenueData } from '@/lib/dashboardCharts';

interface DashboardChartsProps {
  payments?: any[];
  funnel?: any[];
  analytics?: any;
  leadStatusName: (code: string) => string;
  statusColor: (code: string) => string;
  money: (value: number) => string;
}

export function DashboardCharts({ payments = [], funnel = [], leadStatusName, statusColor, money }: DashboardChartsProps) {
  const { t, language } = useTranslation();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';

  const revenueData = useMemo(
    () => buildMonthlyRevenueData(payments, locale),
    [locale, payments],
  );

  const funnelData = useMemo(
    () =>
      (funnel || []).map((item) => ({
        name: leadStatusName(item.code),
        count: item.count,
        color: item.color || statusColor(item.code),
      })),
    [funnel, leadStatusName, statusColor]
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <Card className="hover-lift">
        <CardHeader className="pb-4">
          <CardTitle>{t('revenueTrend')}</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {revenueData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary-500)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--primary-500)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--slate-200)" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--slate-500)', fontSize: 12 }} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--slate-500)', fontSize: 12 }}
                  tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
                />
                <Tooltip
                  formatter={(value: number) => [money(value), t('revenue')]}
                  contentStyle={{
                    borderRadius: '0.625rem',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-lg)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="var(--primary-500)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorRevenue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">{t('noPaymentData')}</div>
          )}
        </CardContent>
      </Card>

      <Card className="hover-lift">
        <CardHeader className="pb-4">
          <CardTitle>{t('conversionFunnel')}</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {funnelData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ left: 24, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="var(--slate-200)" />
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={100}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--slate-600)', fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: 'var(--slate-100)' }}
                  contentStyle={{
                    borderRadius: '0.625rem',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-lg)',
                  }}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {funnelData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">{t('noFunnelData')}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
