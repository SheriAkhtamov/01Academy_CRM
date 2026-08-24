// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskColorPicker } from '../client/src/components/ux/board/TaskColorPicker';
import { i18n } from '../client/src/lib/i18n';

describe('task colour picker', () => {
  beforeEach(() => i18n.setLanguage('en'));

  it('offers a neutral option and every controlled palette colour', () => {
    render(<TaskColorPicker value={null} onChange={() => undefined} />);

    expect(screen.getByRole('group', { name: 'Task colour' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((option) => option.getAttribute('aria-label'))).toEqual([
      'No colour',
      'Blue',
      'Green',
      'Yellow',
      'Violet',
      'Rose',
      'Turquoise',
    ]);
    expect((screen.getByRole('radio', { name: 'No colour' }) as HTMLInputElement).checked).toBe(true);
  });

  it('reports the chosen colour and reflects the controlled value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<TaskColorPicker value={null} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Violet' }));
    expect(onChange).toHaveBeenCalledWith('violet');

    rerender(<TaskColorPicker value="violet" onChange={onChange} />);
    expect((screen.getByRole('radio', { name: 'Violet' }) as HTMLInputElement).checked).toBe(true);
  });
});
