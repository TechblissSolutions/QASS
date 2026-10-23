import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreateTools from '@/components/CreateTools';
import { getAccessToken, refreshAccessToken } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({
  getAccessToken: jest.fn(async () => 'test-token'),
  refreshAccessToken: jest.fn(async () => 'fresh-token'),
}));
jest.mock('@/lib/store', () => ({ useStore: () => ({ s: { projectId: null, profile: null }, ready: true }) }));
jest.mock('@/components/Toast', () => ({ useToast: () => jest.fn() }));
jest.mock('@/components/Modal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/CreateTools.module.css', () => new Proxy({}, { get: (_target, key) => String(key) }));
jest.mock('next/link', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ href, children, ...props }: { href: string; children: unknown; [key: string]: unknown }) =>
      React.createElement('a', { href, ...props }, children),
  };
});
jest.mock('next/navigation', () => {
  const router = { replace: jest.fn() };
  return { usePathname: () => '/create', useRouter: () => router };
});

const originalFetch = global.fetch;

async function renderCreateTools() {
  await act(async () => {
    render(<CreateTools />);
    await new Promise(resolve => window.setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  global.fetch = originalFetch;
});

test('carousel submits each indexed image request and renders returned results', async () => {
  const requests: Array<Record<string, unknown>> = [];
  global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, media_url: `https://cdn.example.com/${requests.length}.png` }),
    } as Response;
  }) as typeof fetch;

  await renderCreateTools();
  fireEvent.change(await screen.findByLabelText('Action'), { target: { value: 'image_carousel' } });
  fireEvent.change(screen.getByLabelText('Creative direction'), { target: { value: 'Bright editorial product still with soft natural light' } });
  fireEvent.change(screen.getByLabelText('Carousel slides'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));

  expect(await screen.findAllByRole('img', { name: /image carousel result/ })).toHaveLength(2);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({ media_type: 'image', media_action: 'image_carousel', variation_index: 1, variation_count: 2 });
  expect(requests[1]).toMatchObject({ media_type: 'image', media_action: 'image_carousel', variation_index: 2, variation_count: 2 });
});

test('expired access token is refreshed and the tool request retries once', async () => {
  const getTokenMock = jest.mocked(getAccessToken);
  const refreshTokenMock = jest.mocked(refreshAccessToken);
  getTokenMock.mockResolvedValueOnce('expired-token').mockResolvedValueOnce('expired-token');
  refreshTokenMock.mockResolvedValueOnce('fresh-token');
  const authorizationHeaders: string[] = [];
  global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    authorizationHeaders.push(headers.Authorization);
    if (authorizationHeaders.length === 1) {
      return { ok: false, status: 401, json: async () => ({ error: 'invalid JWT: token is expired' }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ success: true, media_url: 'https://cdn.example.com/refreshed.png' }) } as Response;
  }) as typeof fetch;

  await renderCreateTools();
  fireEvent.change(await screen.findByLabelText('Creative direction'), { target: { value: 'Bright editorial product still with soft natural light' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));

  expect(await screen.findByRole('img', { name: /result 1/ })).toBeInTheDocument();
  expect(authorizationHeaders).toEqual(['Bearer expired-token', 'Bearer fresh-token']);
  expect(refreshTokenMock).toHaveBeenCalledTimes(1);
});
test('media starter updates the live brief preview without claiming media was generated', async () => {
  await renderCreateTools();
  expect(await screen.findByText('LIVE BRIEF PREVIEW')).toBeInTheDocument();
  expect(screen.getByText('NOT GENERATED')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Use a starter' }));
  const samplePrompt = 'A crisp editorial product photograph with warm studio light, tactile materials, and a confident modern composition.';
  expect(screen.getByLabelText('Creative direction')).toHaveValue(samplePrompt);
  expect(screen.getByText(samplePrompt, { selector: 'strong' })).toBeInTheDocument();
});

test('email swipe save reports browser-only storage rather than account persistence', async () => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ path, body });
    const response = body.action === 'email_swipe'
      ? { success: true, action: 'email_swipe', saved: false, persistence: 'not_configured' }
      : { success: true, action: 'email_variations', emails: [{ subject: 'A helpful update', body: 'A clear, useful email draft.', notes: '' }], warnings: [] };
    return { ok: true, status: 200, json: async () => response } as Response;
  }) as typeof fetch;

  await renderCreateTools();
  fireEvent.click(await screen.findByRole('tab', { name: 'Email Studio' }));
  fireEvent.change(screen.getByLabelText('Email content'), { target: { value: 'Original email content to adapt.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate email' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save to swipe file' }));

  expect(await screen.findByRole('button', { name: 'Saved' })).toBeDisabled();
  expect(screen.getByText('In swipe file')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove saved email' })).toBeInTheDocument();
  expect(screen.getByText('Saved on this browser only. Not synced to your account or other devices.')).toBeInTheDocument();
  expect(requests.map(request => request.body.action)).toEqual(['email_variations', 'email_swipe']);
  expect(requests[0].body.target_language).toBe('English');
  expect(requests[0].body.instructions).toContain('Write every email subject and body in English.');
  await waitFor(() => expect(JSON.parse(localStorage.getItem('techbliss-email-swipe-file-v1') || '[]')).toHaveLength(1));
});

test('success toast is visible and announced as a status popup', () => {
  const { ToastProvider, useToast: useRealToast } = jest.requireActual('@/components/Toast') as typeof import('@/components/Toast');
  function TriggerToast() {
    const toast = useRealToast();
    return <button onClick={() => toast('Saved to swipe file')}>Save email</button>;
  }

  render(<ToastProvider><TriggerToast /></ToastProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Save email' }));

  const notification = screen.getByRole('status');
  expect(notification).toHaveTextContent('Saved to swipe file');
  expect(notification).toHaveClass('toast-pop');
});