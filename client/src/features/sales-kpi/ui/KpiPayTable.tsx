import type { KpiPayLine } from '@shared/sales-kpi';
import { useTranslation } from '@/hooks/useTranslation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { kpiMoney, payKeys, statusKeys } from '../copy';

export function KpiPayTable({ lines }: { lines: KpiPayLine[] }) {
  const { t, language } = useTranslation();
  return <div className="overflow-x-auto rounded-lg border">
    <Table>
      <TableHeader><TableRow>
        <TableHead>{t('kpiPayBreakdown')}</TableHead>
        <TableHead className="text-right">{t('kpiQuantity')}</TableHead>
        <TableHead className="text-right">{t('kpiRate')}</TableHead>
        <TableHead className="text-right">{t('amount')}</TableHead>
      </TableRow></TableHeader>
      <TableBody>{lines.map((line, index) => <TableRow key={`${line.key}-${index}`}>
        <TableCell className="min-w-44">
          <p className="font-medium">{t(payKeys[line.key])}</p>
          {line.from ? <p className="mt-0.5 text-xs text-muted-foreground">{(line.to ? t('kpiPersonRange') : t('kpiFromPerson'))
            .replace('{from}', String(line.from)).replace('{to}', String(line.to))}</p> : null}
          <Badge variant="outline" className="mt-1 text-xs font-normal">{t(statusKeys[line.status])}</Badge>
        </TableCell>
        <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{kpiMoney(line.rateUzs, language)}</TableCell>
        <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{kpiMoney(line.amountUzs, language)}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </div>;
}
