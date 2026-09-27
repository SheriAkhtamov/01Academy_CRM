export const paymentAttachmentsSelect = (paymentAlias: string) => `
  COALESCE((
    SELECT json_agg(json_build_object(
      'id', attachment.id,
      'originalName', attachment.original_name,
      'size', attachment.size,
      'mimeType', attachment.mime_type
    ) ORDER BY attachment.id)
    FROM academy_payment_attachments attachment
    WHERE attachment.payment_id = ${paymentAlias}.id
  ), '[]'::json) AS attachments`;
