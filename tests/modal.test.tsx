import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import Modal from '@/components/Modal';

afterEach(() => {
  jest.restoreAllMocks();
});

test('labels the dialog and contains keyboard focus', () => {
  const onClose = jest.fn();
  const rects = [{} as DOMRect] as unknown as DOMRectList;
  jest.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue(rects);
  render(
    <Modal open onClose={onClose} label="Example dialog">
      <button type="button">First</button>
      <button type="button">Last</button>
    </Modal>,
  );

  const dialog = screen.getByRole('dialog', { name: 'Example dialog' });
  const first = screen.getByRole('button', { name: 'First' });
  const last = screen.getByRole('button', { name: 'Last' });

  expect(first).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(dialog).toHaveAttribute('aria-modal', 'true');
});

test('restores focus to the opener when the dialog closes', () => {
  function ModalHarness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
        <Modal open={open} onClose={() => setOpen(false)} label="Example dialog">
          <button type="button" onClick={() => setOpen(false)}>Close dialog</button>
        </Modal>
      </>
    );
  }

  render(<ModalHarness />);
  const opener = screen.getByRole('button', { name: 'Open dialog' });
  opener.focus();
  fireEvent.click(opener);

  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(opener).toHaveFocus();
});
