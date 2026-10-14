-- Normalize the retired payment choices without changing payment amounts,
-- dates, statuses, allocation versions, or historical sales KPI facts.
UPDATE academy_payments
SET type = 'monthly'
WHERE type IN ('installment_1_2', 'installment_2_2');
