import { fireEvent, render, screen } from '@testing-library/react';
import HomePage from '@/app/page';

const mockSet = jest.fn();
const mockPush = jest.fn();

jest.mock('@/lib/store', () => ({
  useStore: () => ({ s: { url: '' }, set: mockSet, ready: true }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

test('announces invalid website input and associates the error with the field', () => {
  render(<HomePage />);
  const website = screen.getByRole('textbox', { name: 'Company website' });

  fireEvent.click(screen.getByRole('button', { name: /Analyze website/ }));

  expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid website');
  expect(website).toHaveAttribute('aria-invalid', 'true');
  expect(website).toHaveAttribute('aria-describedby', 'company-website-error');
  expect(mockSet).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

test('normalizes a valid website and continues to analysis', () => {
  render(<HomePage />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Company website' }), {
    target: { value: 'example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Analyze website/ }));

  expect(mockSet).toHaveBeenCalledWith({ url: 'https://example.com' });
  expect(mockPush).toHaveBeenCalledWith('/analyse?new=1&url=https%3A%2F%2Fexample.com');
});

test('explains the website-to-content workflow in plain language', () => {
  render(<HomePage />);

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    /Create on-brand content from a company website\./i,
  );
  expect(screen.getByRole('heading', { name: 'Analyze a company website' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Create marketing content' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Review and schedule' })).toBeInTheDocument();
});

test('labels the marketing product journey as an illustrative preview', () => {
  render(<HomePage />);

  expect(screen.getByRole('link', { name: 'Sparrow by TechBliss' })).toBeInTheDocument();
  expect(screen.getByRole('img', {
    name: /illustrative product preview showing company research, brand context, sample marketing content, and calendar planning/i,
  })).toBeInTheDocument();
  expect(screen.getByText('Illustrative preview · not a live schedule')).toBeInTheDocument();
  expect(screen.getByText('01 / COMPANY RESEARCH')).toBeInTheDocument();
  expect(screen.getByText('02 / BRAND CONTEXT')).toBeInTheDocument();
  expect(screen.getByText('03 / CONTENT FOR REVIEW')).toBeInTheDocument();
  expect(screen.getByText('04 / CONTENT PLAN')).toBeInTheDocument();
});
