import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import FeedbackAdminPage, { sortItems, type AdminItem } from './FeedbackAdminPage';

const ITEMS: AdminItem[] = [
  { id: 1, entity: 'snake', text: 'pause button', votes: 2, status: 'Suggested', notes: '', active: 1, created_at: '2024-01-01 00:00:00', isNew: false },
  { id: 2, entity: 'pixelwhimsy', text: 'more colors', votes: 9, status: 'Implemented', notes: 'shipped in v2', active: 1, created_at: '2024-03-01 00:00:00', isNew: true },
  { id: 3, entity: 'big-pac-tiny-man', text: 'harder ghosts', votes: 5, status: 'Suggested', notes: '', active: 1, created_at: '2024-02-01 00:00:00', isNew: false },
];

describe('sortItems', () => {
  it('sorts by votes ascending and descending', () => {
    expect(sortItems(ITEMS, 'votes', 'asc').map((i) => i.votes)).toEqual([2, 5, 9]);
    expect(sortItems(ITEMS, 'votes', 'desc').map((i) => i.votes)).toEqual([9, 5, 2]);
  });
  it('sorts by entity, status, and date', () => {
    expect(sortItems(ITEMS, 'entity', 'asc').map((i) => i.entity)).toEqual([
      'big-pac-tiny-man',
      'pixelwhimsy',
      'snake',
    ]);
    expect(sortItems(ITEMS, 'status', 'asc').map((i) => i.status)).toEqual([
      'Implemented',
      'Suggested',
      'Suggested',
    ]);
    expect(sortItems(ITEMS, 'created_at', 'desc').map((i) => i.id)).toEqual([2, 3, 1]);
  });
  it('does not mutate the input', () => {
    const copy = [...ITEMS];
    sortItems(ITEMS, 'votes', 'asc');
    expect(ITEMS).toEqual(copy);
  });
});

function adminFetch() {
  return vi.fn((url: string, opts?: RequestInit) => {
    const method = opts?.method ?? 'GET';
    if (url === '/api/admin/feedback' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: ITEMS }) } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
  });
}

async function unlock() {
  fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  // table appears once the mocked load resolves
  await screen.findByRole('table');
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FeedbackAdminPage — gate', () => {
  it('asks for a password before showing anything', () => {
    global.fetch = adminFetch() as unknown as typeof fetch;
    render(<FeedbackAdminPage />);
    expect(screen.getByLabelText('Admin password')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error on a wrong password and stores a good one', async () => {
    const fetchMock = vi.fn((_url: string, opts?: RequestInit) => {
      const token = (opts?.headers as Record<string, string>)?.Authorization;
      if (token === 'Bearer good') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: ITEMS }) } as Response);
      }
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<FeedbackAdminPage />);
    fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText(/incorrect password/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByRole('table');
    expect(sessionStorage.getItem('feedback_admin_token')).toBe('good');
  });
});

describe('FeedbackAdminPage — table', () => {
  beforeEach(() => {
    global.fetch = adminFetch() as unknown as typeof fetch;
  });

  it('lists every item with a NEW badge on fresh ones', async () => {
    render(<FeedbackAdminPage />);
    await unlock();
    expect(screen.getByText('pause button')).toBeInTheDocument();
    expect(screen.getByText('more colors')).toBeInTheDocument();
    expect(screen.getByText('harder ghosts')).toBeInTheDocument();
    // Only the isNew item carries the NEW badge.
    const badges = screen.getAllByText('NEW');
    expect(badges).toHaveLength(1);
  });

  it('sorts when a column header is clicked', async () => {
    render(<FeedbackAdminPage />);
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: /Votes/ }));
    // First click on a fresh column defaults votes to descending: 9, 5, 2.
    let rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('more colors');
    // Clicking again flips to ascending: 2, 5, 9.
    fireEvent.click(screen.getByRole('button', { name: /Votes/ }));
    rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('pause button');
  });

  it('deletes an item via the admin API', async () => {
    const fetchMock = adminFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<FeedbackAdminPage />);
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: 'Delete item 1' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/feedback/1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    await waitFor(() => expect(screen.queryByText('pause button')).not.toBeInTheDocument());
  });

  it('changes status via the admin API', async () => {
    const fetchMock = adminFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<FeedbackAdminPage />);
    await unlock();
    fireEvent.change(screen.getByLabelText('Status for item 1'), {
      target: { value: 'Implemented' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/feedback/1',
      expect.objectContaining({ method: 'PATCH' }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Status for item 1') as HTMLSelectElement).value).toBe(
        'Implemented',
      ),
    );
  });

  it('shows existing notes and lets me edit and save them', async () => {
    const fetchMock = adminFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<FeedbackAdminPage />);
    await unlock();

    // Existing note is shown.
    expect((screen.getByLabelText('Notes for item 2') as HTMLTextAreaElement).value).toBe(
      'shipped in v2',
    );

    // Save is disabled until the note actually changes.
    const saveBtn = screen.getByRole('button', { name: 'Save notes for item 1' });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Notes for item 1'), {
      target: { value: 'planned for next release' },
    });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/feedback/1',
      expect.objectContaining({ method: 'PATCH' }),
    );
    const patchCall = fetchMock.mock.calls.find(
      (c) => c[0] === '/api/admin/feedback/1' && (c[1] as RequestInit)?.method === 'PATCH',
    );
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
      notes: 'planned for next release',
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save notes for item 1' }),
      ).toBeDisabled(),
    );
  });
});
