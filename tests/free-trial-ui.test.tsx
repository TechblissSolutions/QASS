import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FreeTrial from '@/components/FreeTrial';

jest.mock('@/components/FreeTrial.module.css', () => new Proxy({}, { get: (_target, key) => String(key) }));

const originalFetch = global.fetch;

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = jest.fn();
});

function installFetch(generateResponse: { status: number; body: Record<string, unknown> }) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/free-trial/session')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          credits_total: 100,
          credits_remaining: 100,
          used: false,
          linkedin_used: false,
          blog_used: false,
          generations: [],
        }),
      } as Response;
    }
    return {
      ok: generateResponse.status >= 200 && generateResponse.status < 300,
      status: generateResponse.status,
      json: async () => generateResponse.body,
    } as Response;
  }) as typeof fetch;
}

async function submitLinkedIn() {
  render(<FreeTrial />);
  const choice = await screen.findByRole('button', { name: /LinkedIn Post/ });
  await waitFor(() => expect(choice).toBeEnabled());
  fireEvent.click(choice);
  fireEvent.change(screen.getByPlaceholderText('e.g. What makes a great customer experience'), {
    target: { value: 'Customer onboarding' },
  });
  fireEvent.change(screen.getByPlaceholderText('Who should this speak to?'), {
    target: { value: 'SaaS founders' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Generate LinkedIn Post/ }));
}

afterEach(() => {
  global.fetch = originalFetch;
});

test('shows a signup prompt when that specific trial format was already used', async () => {
  installFetch({ status: 409, body: { code: 'TRIAL_TYPE_USED', generation_type: 'linkedin', error: 'Your LinkedIn trial has already been used.' } });
  await submitLinkedIn();

  expect(await screen.findByText('Your LinkedIn trial has already been used.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Sign up to generate more/ })).toHaveAttribute('href', '/signup');
});

test('shows a retryable reservation-conflict message without marking the format used', async () => {
  installFetch({ status: 409, body: { code: 'TRIAL_RESERVATION_CONFLICT', error: 'Another request currently owns this slot.' } });
  await submitLinkedIn();

  expect(await screen.findByText('Another request currently owns this slot.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Generate LinkedIn Post/ })).toBeEnabled();
  expect(screen.queryByRole('link', { name: /Sign up to generate more/ })).not.toBeInTheDocument();
});

test('explains an ambiguous reserved generation without showing the used-format signup prompt', async () => {
  installFetch({ status: 409, body: { code: 'TRIAL_GENERATION_RESERVED', generation_type: 'linkedin', error: 'Refresh to check for a saved draft.' } });
  await submitLinkedIn();

  expect(await screen.findByText('Refresh to check for a saved draft.')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Sign up to generate more/ })).not.toBeInTheDocument();
});

test('shows a retry action for non-409 server errors', async () => {
  installFetch({ status: 502, body: { error: 'The trial service is temporarily unavailable.' } });
  await submitLinkedIn();

  expect(await screen.findByText('The trial service is temporarily unavailable. Please retry.')).toBeInTheDocument();
});
