import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GalleryPage, { readCookie, writeCookie, shuffle } from './GalleryPage';

const ITEMS = [
  { title: 'Alpha', file: 'a.jpg', description: 'desc A' },
  { title: 'Beta', file: 'b.jpg', description: 'desc B' },
  { title: 'Gamma', file: 'c.jpg', description: 'desc C' },
];

function mockFetchOk(data: unknown) {
  return vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response),
  );
}

function renderGallery(folder = 'Art') {
  return render(
    <MemoryRouter>
      <GalleryPage folder={folder} heading={folder} />
    </MemoryRouter>,
  );
}

// Clear our gallery cookies between tests.
function clearGalleryCookies() {
  for (const c of document.cookie.split('; ')) {
    const name = c.split('=')[0];
    if (name.startsWith('ejgallery_day_')) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
}

describe('GalleryPage helpers', () => {
  beforeEach(clearGalleryCookies);

  it('round-trips a cookie value', () => {
    expect(readCookie('ejgallery_day_Test')).toBeNull();
    writeCookie('ejgallery_day_Test', 'hello world');
    expect(readCookie('ejgallery_day_Test')).toBe('hello world');
  });

  it('shuffle keeps the same multiset and does not mutate input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const frozen = [...input];
    const out = shuffle(input);
    expect(input).toEqual(frozen); // original untouched
    expect([...out].sort((a, b) => a - b)).toEqual(frozen); // same elements
  });
});

describe('GalleryPage behavior', () => {
  beforeEach(() => {
    clearGalleryCookies();
    // Pin the cookie to today so the list keeps its server order (no shuffle),
    // making navigation assertions deterministic.
    writeCookie('ejgallery_day_Art', new Date().toDateString());
    global.fetch = mockFetchOk(ITEMS) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('fetches the folder contents and shows the first item', async () => {
    renderGallery('Art');
    expect(await screen.findByRole('img', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByText('desc A')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/media/Art/contents.json');
  });

  it('selecting a title swaps the main image', async () => {
    renderGallery('Art');
    await screen.findByRole('img', { name: 'Alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'Gamma' }));
    expect(await screen.findByRole('img', { name: 'Gamma' })).toBeInTheDocument();
  });

  it('arrow keys move with wrap-around', async () => {
    renderGallery('Art');
    await screen.findByRole('img', { name: 'Alpha' });

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(await screen.findByRole('img', { name: 'Beta' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(await screen.findByRole('img', { name: 'Alpha' })).toBeInTheDocument();

    // Left from the first item wraps to the last.
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(await screen.findByRole('img', { name: 'Gamma' })).toBeInTheDocument();

    // Right from the last wraps back to the first.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(await screen.findByRole('img', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('clicking the image opens the full-res original in a child window', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderGallery('Art');
    const img = await screen.findByRole('img', { name: 'Alpha' });
    fireEvent.click(img);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0]).toContain('a.jpg');
  });

  it('shows an error message when the fetch fails', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404 } as Response),
    ) as typeof fetch;
    renderGallery('Art');
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
  });
});

describe('GalleryPage auto-advance', () => {
  beforeEach(() => {
    clearGalleryCookies();
    writeCookie('ejgallery_day_Art', new Date().toDateString());
    global.fetch = mockFetchOk(ITEMS) as typeof fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it('advances to the next photo after the idle interval', async () => {
    renderGallery('Art');
    // Flush the fetch promise chain under fake timers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Alpha');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Beta');
  });
});
