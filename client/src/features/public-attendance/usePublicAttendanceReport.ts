import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { publicAttendanceReportQuerySchema, type PublicAttendanceReportQuery } from '@shared/contracts/public-attendance';
import { publicAttendanceApi, PublicAttendanceApiError } from './api';

export function usePublicAttendanceReport(onAccessLost: () => void) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [period, setPeriod] = useState<PublicAttendanceReportQuery>({});
  const [invalidPeriod, setInvalidPeriod] = useState(false);
  const report = useQuery({
    queryKey: ['public-attendance', 'report', period],
    queryFn: ({ signal }) => publicAttendanceApi.report(period, signal),
    refetchInterval: 45_000,
  });
  useEffect(() => {
    if (report.error instanceof PublicAttendanceApiError && [401, 403].includes(report.error.status)) onAccessLost();
  }, [onAccessLost, report.error]);

  const applyPeriod = (event: FormEvent) => {
    event.preventDefault();
    const result = publicAttendanceReportQuerySchema.safeParse({ from: from || undefined, to: to || undefined });
    setInvalidPeriod(!result.success);
    if (result.success) setPeriod(result.data);
  };
  const resetPeriod = () => {
    setFrom('');
    setTo('');
    setInvalidPeriod(false);
    setPeriod({});
  };
  return { report, from, to, setFrom, setTo, applyPeriod, resetPeriod, invalidPeriod };
}
