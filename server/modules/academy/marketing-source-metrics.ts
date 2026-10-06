type MetricRow = Record<string, any>;

const positiveId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const dateValue = (value: unknown): number | null => {
  if (!value) return null;
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export function marketingPaymentAttribution(students: MetricRow[]) {
  const studentById = new Map(students.map((student) => [Number(student.id), student]));
  const studentsByLead = new Map<number, number[]>();
  for (const student of students) {
    const leadId = positiveId(student.leadId);
    const studentId = positiveId(student.id);
    if (leadId && studentId) studentsByLead.set(leadId, [...(studentsByLead.get(leadId) ?? []), studentId]);
  }
  const leadIdForPayment = (payment: MetricRow) => positiveId(payment.leadId)
    ?? positiveId(studentById.get(Number(payment.studentId))?.leadId);
  const customerKeyForPayment = (payment: MetricRow): string | null => {
    const studentId = positiveId(payment.studentId);
    if (studentId) return `student:${studentId}`;
    const leadId = leadIdForPayment(payment);
    if (!leadId) return null;
    // A lead payment followed by the student's payments is one customer when
    // the link is unambiguous. Siblings linked to one lead stay distinct.
    const linkedStudents = studentsByLead.get(leadId) ?? [];
    return linkedStudents.length === 1 ? `student:${linkedStudents[0]}` : `lead:${leadId}`;
  };
  return { leadIdForPayment, customerKeyForPayment };
}

export function buildMarketingSourceMetrics({
  sources, leads, students, paidPayments, expenses, periodStart, periodEnd, recognizedExpense,
}: {
  sources: MetricRow[];
  leads: MetricRow[];
  students: MetricRow[];
  paidPayments: MetricRow[];
  expenses: MetricRow[];
  periodStart: Date;
  periodEnd: Date;
  recognizedExpense: (expense: MetricRow) => number;
}) {
  const leadById = new Map(leads.map((lead) => [Number(lead.id), lead]));
  const inPeriod = (value: unknown) => {
    const timestamp = dateValue(value);
    return timestamp !== null && timestamp >= periodStart.getTime() && timestamp < periodEnd.getTime();
  };
  const { leadIdForPayment, customerKeyForPayment } = marketingPaymentAttribution(students);
  const customerTotals = new Map<string, { firstPaidAt: number | null; revenue: number; sourceId: number | null }>();
  for (const payment of paidPayments) {
    if (Number(payment.amountUzs || 0) <= 0) continue;
    const key = customerKeyForPayment(payment);
    if (!key) continue;
    const leadId = leadIdForPayment(payment);
    const paidAt = dateValue(payment.paidAt ?? payment.createdAt);
    const customer = customerTotals.get(key) ?? {
      firstPaidAt: null,
      revenue: 0,
      sourceId: leadId ? positiveId(leadById.get(leadId)?.sourceId) : null,
    };
    customer.revenue += Number(payment.amountUzs || 0);
    if (paidAt !== null && (customer.firstPaidAt === null || paidAt < customer.firstPaidAt)) {
      customer.firstPaidAt = paidAt;
    }
    customerTotals.set(key, customer);
  }

  return sources.map((source) => {
    const sourceId = Number(source.id);
    const periodLeads = leads.filter((lead) => Number(lead.sourceId) === sourceId && inPeriod(lead.createdAt));
    const newCustomers = [...customerTotals.values()].filter((customer) => customer.sourceId === sourceId
      && customer.firstPaidAt !== null
      && customer.firstPaidAt >= periodStart.getTime()
      && customer.firstPaidAt < periodEnd.getTime());
    // Payment attribution uses every lead, including historical and archived
    // ones. Restricting these identities to the creation cohort hid renewals.
    const revenue = paidPayments.filter((payment) => {
      const leadId = leadIdForPayment(payment);
      return leadId !== null && Number(leadById.get(leadId)?.sourceId) === sourceId && inPeriod(payment.paidAt ?? payment.createdAt);
    }).reduce((sum, payment) => sum + Number(payment.amountUzs || 0), 0);
    const sourceExpenses = expenses.filter((expense) => Number(expense.sourceId) === sourceId)
      .reduce((sum, expense) => sum + recognizedExpense(expense), 0);
    const cac = newCustomers.length > 0 ? Math.round(sourceExpenses / newCustomers.length) : null;
    const averageLtv = newCustomers.length > 0
      ? newCustomers.reduce((sum, customer) => sum + customer.revenue, 0) / newCustomers.length
      : null;
    return {
      sourceId: source.id,
      sourceName: source.name,
      leads: periodLeads.length,
      paidStudents: newCustomers.length,
      revenue,
      expenses: sourceExpenses,
      cpl: periodLeads.length > 0 ? Math.round(sourceExpenses / periodLeads.length) : null,
      cac,
      roas: sourceExpenses > 0 ? Number((revenue / sourceExpenses).toFixed(2)) : null,
      ltvCac: cac !== null && cac > 0 && averageLtv !== null ? Number((averageLtv / cac).toFixed(2)) : null,
    };
  });
}
