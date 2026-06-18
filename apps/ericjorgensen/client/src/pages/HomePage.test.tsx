import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './HomePage';

function mockFetch() {
  return vi.fn((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/visit')) {
      return Promise.resolve({ json: () => Promise.resolve({ count: 42 }) } as Response);
    }
    // /api/portraits — empty pool, so the strip renders nothing
    return Promise.resolve({ json: () => Promise.resolve([]) } as Response);
  });
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = mockFetch() as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HomePage — header & frame', () => {
  it('renders the name, kicker, and the three layout tabs', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: 'Eric Jorgensen' })).toBeInTheDocument();
    expect(screen.getByText('A Field Guide to a Body of Work')).toBeInTheDocument();
    for (const t of ['Field Guide', 'Plates', 'Spectrum']) {
      expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
    }
  });

  it('shows the visit count once recorded', async () => {
    renderHome();
    expect(await screen.findByText('42')).toBeInTheDocument();
  });

  it('defaults to the Spectrum layout', () => {
    renderHome();
    expect(screen.getByRole('button', { name: 'Spectrum' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('The Machine')).toBeInTheDocument();
    expect(screen.getByText('The Hand')).toBeInTheDocument();
  });
});

describe('HomePage — categories (machine → hand)', () => {
  it('orders the category headings Pure AI → … → Pure Creative', () => {
    renderHome();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Pure AI Output',
      'Hand-Written, AI-Enhanced',
      'Hand-Written Code',
      'Pure Creative Output',
    ]);
  });

  it('links external projects with href and creative work to internal routes', () => {
    renderHome();
    expect(screen.getByRole('link', { name: 'PixelWhimsy' })).toHaveAttribute(
      'href',
      'https://pixelwhimsy.com',
    );
    expect(screen.getByRole('link', { name: 'Drawing' })).toHaveAttribute('href', '/art');
  });
});

describe('HomePage — layout switching & persistence', () => {
  it('swaps between spectrum, guide, and plates', () => {
    renderHome();
    // Spectrum is the default.
    expect(screen.getByText('The Machine')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Field Guide' }));
    expect(
      screen.getByText('No specimens collected yet — this drawer is waiting.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('The Machine')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Plates' }));
    expect(screen.getAllByText('Awaiting specimens.').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('No specimens collected yet — this drawer is waiting.'),
    ).not.toBeInTheDocument();
  });

  it('persists the chosen layout to localStorage', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Field Guide' }));
    expect(localStorage.getItem('ej_home_layout')).toBe('guide');
  });

  it('restores a previously chosen layout on next visit', () => {
    localStorage.setItem('ej_home_layout', 'plates');
    renderHome();
    expect(screen.getByRole('button', { name: 'Plates' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByText('Awaiting specimens.').length).toBeGreaterThan(0);
  });
});
