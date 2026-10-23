import { fireEvent, render, screen } from '@testing-library/react';
import type { Piece } from '@/lib/types';

jest.mock('@/components/ContentCard.css', () => ({}));
jest.mock('@/components/Toast', () => ({ useToast: () => jest.fn() }));

import ContentCard from '@/components/ContentCard';

const piece: Piece = {
  id: 'piece-1',
  section: 'social',
  channel: 'Instagram',
  format: 'Caption',
  title: 'Draft title',
  bodyHtml: '<p>Draft body</p>',
  bodyText: 'Draft body',
  wordCount: 2,
};

test('opens content through a named button and keeps scheduling as a separate action', () => {
  const onOpen = jest.fn();
  const onSchedule = jest.fn();
  render(<ContentCard piece={piece} onOpen={onOpen} onSchedule={onSchedule} />);

  const openButton = screen.getByRole('button', { name: 'Open content: Draft title' });
  expect(openButton).toHaveAttribute('type', 'button');
  fireEvent.click(openButton);
  expect(onOpen).toHaveBeenCalledWith('piece-1');

  fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
  expect(onSchedule).toHaveBeenCalledWith('piece-1');
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('article')).not.toHaveAttribute('tabindex');
});
