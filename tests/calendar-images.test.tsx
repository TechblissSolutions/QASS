import { fireEvent, render, screen } from '@testing-library/react';
import CalendarPage from '@/app/calendar/page';

const mockSearchParams = { get: jest.fn(() => null) };

jest.mock('@/lib/store', () => ({
  useStore: () => ({
    s: { projectId: 'project-1', brandTheme: null },
    ready: true,
  }),
}));
jest.mock('@/lib/auth', () => ({ getAccessToken: jest.fn(async () => 'test-token') }));
jest.mock('@/components/Toast', () => ({ useToast: () => jest.fn() }));
jest.mock('@/components/BrandTheme', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/CompanyHeader', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/StoreLoading', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ScheduleComposer', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Modal', () => ({
  __esModule: true,
  default: ({ open, label, children }: { open: boolean; label: string; children: React.ReactNode }) =>
    open ? <div role="dialog" aria-label={label}>{children}</div> : null,
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}));

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      scheduled: [{
        id: 'scheduled-1',
        title: 'Scheduled post',
        caption_text: 'Caption',
        media_url: 'https://cdn.example.com/scheduled.jpg',
        scheduled_at: '2026-10-24T10:00:00.000Z',
        timezone: 'UTC',
        status: 'scheduled',
        platforms: [],
      }],
      generated: [{
        jobId: 'job-1',
        pieceId: 'piece-1',
        generatedAt: '2026-10-23T10:00:00.000Z',
        generationStatus: 'completed',
        title: 'Generated post',
        captionHtml: '<p>Caption</p>',
        captionText: 'Caption',
        channel: 'Instagram',
        format: 'Caption',
        mediaUrl: 'https://cdn.example.com/generated.jpg',
        mediaType: 'image',
      }],
    }),
  } as unknown as Response)) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

test('defers thumbnail loading in the planner and previous-generation list', async () => {
  render(<CalendarPage />);

  await screen.findByText('Scheduled post');
  const scheduledImage = document.querySelector('.planner-table img');
  expect(scheduledImage).toHaveAttribute('loading', 'lazy');
  expect(scheduledImage).toHaveAttribute('decoding', 'async');

  fireEvent.click(screen.getByRole('button', { name: /Add New Post/ }));
  fireEvent.click(screen.getByRole('button', { name: /Use a previous generation/ }));

  await screen.findByRole('dialog', { name: 'Previous generations' });
  const previousImage = document.querySelector('.previous-post-list img');
  expect(previousImage).toHaveAttribute('src', 'https://cdn.example.com/generated.jpg');
  expect(previousImage).toHaveAttribute('loading', 'lazy');
  expect(previousImage).toHaveAttribute('decoding', 'async');
});
