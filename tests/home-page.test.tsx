import { render, screen, within } from '@testing-library/react';
import HomePage from '@/app/page';

jest.mock('@/lib/auth', () => ({
  getAccessToken: jest.fn(async () => null),
}));

test('shows the current primary navigation and brand home link', () => {
  render(<HomePage />);

  expect(screen.getByRole('link', { name: 'Sparrow by TechBliss home' })).toHaveAttribute('href', '/');

  const navigation = screen.getByRole('navigation', { name: 'Main' });
  expect(within(navigation).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '#top');
  expect(within(navigation).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '#how');
  expect(within(navigation).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
  expect(within(navigation).getByRole('link', { name: 'Free trial' })).toHaveAttribute('href', '/free-trial');
  const signInLinks = screen.getAllByRole('link', { name: 'Sign in' });
  expect(signInLinks).toHaveLength(2);
  expect(signInLinks.every(link => link.getAttribute('href') === '/login')).toBe(true);
});

test('presents the current hero message and calls to action', () => {
  render(<HomePage />);

  expect(screen.getByRole('heading', {
    level: 1,
    name: 'Content for every company. One workspace.',
  })).toBeInTheDocument();
  expect(screen.getByText(/Paste a company website\. Sparrow learns the brand/i)).toBeInTheDocument();
  const getStartedLinks = screen.getAllByRole('link', { name: 'Get started' });
  expect(getStartedLinks.length).toBeGreaterThan(0);
  expect(getStartedLinks.every(link => link.getAttribute('href') === '/signup')).toBe(true);
  expect(screen.getByRole('link', { name: 'See how it works' })).toHaveAttribute('href', '#how');
});

test('explains the current three-step workflow', () => {
  render(<HomePage />);

  expect(screen.getByRole('heading', { name: 'From a website to a content calendar.' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Add the company website' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Get a brand workspace' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Generate, edit, schedule' })).toBeInTheDocument();
});

test('labels the example-post section and renders the illustrative product preview', () => {
  const { container } = render(<HomePage />);

  const examplePosts = screen.getByRole('region', { name: 'Example posts' });
  expect(within(examplePosts).getByRole('heading', {
    name: 'On-brand posts for every channel.',
  })).toBeInTheDocument();
  expect(within(examplePosts).getByText('Example posts, generated from a company website.')).toBeInTheDocument();

  const productPreview = container.querySelector('.sp-stage');
  expect(productPreview).toHaveAttribute('aria-hidden', 'true');
  expect(within(productPreview as HTMLElement).getByText('Acme Studio')).toBeInTheDocument();
  expect(within(productPreview as HTMLElement).getByText('Instagram')).toBeInTheDocument();
  expect(within(productPreview as HTMLElement).getByText(/Behind every launch is a team that cares/)).toBeInTheDocument();

  expect(within(examplePosts).getByText('How we turned one website into a month of posts.')).toBeInTheDocument();
  expect(within(examplePosts).getByText('A 60-second intro to the company.')).toBeInTheDocument();
});
