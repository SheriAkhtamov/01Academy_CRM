import type { KpiPayLine } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { kpiMoney, payKeys, statusKeys } from '../copy';

export function KpiPayTable({ lines }: { lines: KpiPayLine[] }) {
  const { t, language } = useTranslation();
  return <div className="overflow-x-auto rounded-lg border">
    <table className="w-full text-sm [&_th]:p-3 [&_th:first-child]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:p-3 [&_tr]:border-b [&_tr:last-child]:border-0">
      <thead><tr>
        <th>{t('kpiPayBreakdown')}</th>
        <th className="text-right">{t('kpiQuantity')}</th>
        <th className="text-right">{t('kpiRate')}</th>
        <th className="text-right">{t('amount')}</th>
      </tr></thead>
      <tbody>{lines.map((line, index) => <tr key={`${line.key}-${index}`}>
        <td className="min-w-44">
          <p className="font-medium">{t(payKeys[line.key])}</p>
          {line.from ? <p className="mt-0.5 text-xs text-muted-foreground">{(line.to ? t('kpiPersonRange') : t('kpiFromPerson'))
            .replace('{from}', String(line.from)).replace('{to}', String(line.to))}</p> : null}
          <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{t(statusKeys[line.status])}</span>
        </td>
        <td className="text-right tabular-nums">{line.quantity}</td>
        <td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{kpiMoney(line.rateUzs, language)}</td>
        <td className="whitespace-nowrap text-right font-semibold tabular-nums">{kpiMoney(line.amountUzs, language)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
