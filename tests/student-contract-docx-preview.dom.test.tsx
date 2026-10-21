// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StudentContractDocxPreview } from '../client/src/features/student-contracts/StudentContractDocxPreview';

afterEach(cleanup);

it('renders a real DOCX with text and a table in a script-free frame and blocks link navigation', async () => {
  const bytes = readFileSync('tests/fixtures/student-contracts/preview.docx');
  const blob = new Blob([Uint8Array.from(bytes)]);
  const onError = vi.fn();
  render(<StudentContractDocxPreview blob={blob} name="Договор.docx" onError={onError} />);
  const frame = screen.getByTitle('Договор.docx') as HTMLIFrameElement;
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
  expect(frame.srcdoc).toContain("default-src 'none'");
  expect(frame.srcdoc).toContain("img-src data:");
  expect(frame.srcdoc).toContain("form-action 'none'");
  fireEvent.load(frame);
  await waitFor(() => expect(frame.getAttribute('aria-busy')).toBe('false'));
  expect(frame.contentDocument!.body.textContent).toContain('Договор А-07/01');
  expect(frame.contentDocument!.querySelector('table')!.textContent).toContain('Тестовый ученик');
  const link = frame.contentDocument!.querySelector('a')!;
  expect(fireEvent.click(link)).toBe(false);
  expect(frame.contentDocument!.querySelector('script')).toBeNull();
  expect(onError).not.toHaveBeenCalled();
});

it('reports an unreadable DOCX without exposing parser details', async () => {
  const onError = vi.fn();
  render(<StudentContractDocxPreview blob={new Blob(['not a document'])} name="Повреждённый.docx" onError={onError} />);
  fireEvent.load(screen.getByTitle('Повреждённый.docx'));
  await waitFor(() => expect(onError).toHaveBeenCalledOnce());
});
