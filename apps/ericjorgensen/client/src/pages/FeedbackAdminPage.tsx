import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react';
import styles from './FeedbackAdminPage.module.css';

// Secret, password-gated console for managing all portfolio feedback. The token
// is checked by the feedback service on every request; we keep it only in
// sessionStorage (cleared when the browser closes).

const TOKEN_KEY = 'feedback_admin_token';
const STATUSES = ['Suggested', 'Implemented'] as const;
type Status = (typeof STATUSES)[number];

export interface AdminItem {
  id: number;
  entity: string;
  text: string;
  votes: number;
  status: Status;
  notes: string;
  active: number;
  created_at: string;
  isNew: boolean;
}

export type SortKey = 'entity' | 'created_at' | 'votes' | 'status';

/** Pure, stable sort used by the table (extracted so it can be unit tested). */
export function sortItems(items: AdminItem[], key: SortKey, dir: 'asc' | 'desc'): AdminItem[] {
  const sorted = [...items].sort((a, b) => {
    const cmp =
      key === 'votes' ? a.votes - b.votes : String(a[key]).localeCompare(String(b[key]));
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

function formatDate(raw: string): string {
  const d = new Date(`${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString();
}

export default function FeedbackAdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '');
  const [input, setInput] = useState('');
  const [items, setItems] = useState<AdminItem[] | null>(null);
  const [loading, setLoading] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)));
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});

  const load = useCallback(async (t: string): Promise<boolean> => {
    setLoading(true);
    setError(false);
    setAuthError(false);
    try {
      const res = await fetch('/api/admin/feedback', {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        setAuthError(true);
        setItems(null);
        return false;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: AdminItem[] };
      setItems(data.items);
      setNoteDrafts({});
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  const submitToken = async (e: FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    const ok = await load(t);
    if (ok) {
      sessionStorage.setItem(TOKEN_KEY, t);
      setToken(t);
    }
  };

  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setItems(null);
    setInput('');
  };

  const remove = async (id: number) => {
    await fetch(`/api/admin/feedback/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setItems((cur) => (cur ? cur.filter((i) => i.id !== id) : cur));
  };

  const changeStatus = async (id: number, status: Status) => {
    await fetch(`/api/admin/feedback/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setItems((cur) => (cur ? cur.map((i) => (i.id === id ? { ...i, status } : i)) : cur));
  };

  const saveNotes = async (id: number) => {
    const notes = noteDrafts[id];
    if (notes === undefined) return;
    await fetch(`/api/admin/feedback/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    setItems((cur) => (cur ? cur.map((i) => (i.id === id ? { ...i, notes } : i)) : cur));
    setNoteDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  };

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'created_at' || key === 'votes' ? 'desc' : 'asc');
    }
  };

  const sorted = useMemo(
    () => (items ? sortItems(items, sortKey, sortDir) : []),
    [items, sortKey, sortDir],
  );

  if (items === null) {
    return (
      <div className={styles.gate}>
        <form className={styles.gateForm} onSubmit={submitToken}>
          <h1 className={styles.gateTitle}>Feedback admin</h1>
          <label htmlFor="admin-token">Admin password</label>
          <input
            id="admin-token"
            type="password"
            className={styles.gateInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          {authError && <p className={styles.error}>Incorrect password.</p>}
          {error && <p className={styles.error}>Could not reach the feedback service.</p>}
          <button type="submit" className={styles.button} disabled={loading || !input.trim()}>
            {loading ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      </div>
    );
  }

  const arrow = (key: SortKey) => (key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Feedback admin</h1>
        <div className={styles.headerActions}>
          <span className={styles.count}>{items.length} items</span>
          <button type="button" className={styles.button} onClick={() => load(token)}>
            Refresh
          </button>
          <button type="button" className={styles.buttonGhost} onClick={logout}>
            Lock
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <p className={styles.empty}>No feedback yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.entityCol}>
                <button type="button" className={styles.sortBtn} onClick={() => toggleSort('entity')}>
                  Entity{arrow('entity')}
                </button>
              </th>
              <th className={styles.textCol}>Feedback</th>
              <th>
                <button type="button" className={styles.sortBtn} onClick={() => toggleSort('votes')}>
                  Votes{arrow('votes')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={styles.sortBtn}
                  onClick={() => toggleSort('created_at')}
                >
                  Date{arrow('created_at')}
                </button>
              </th>
              <th>
                <button type="button" className={styles.sortBtn} onClick={() => toggleSort('status')}>
                  Status{arrow('status')}
                </button>
              </th>
              <th className={styles.notesCol}>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr key={item.id} className={item.isNew ? styles.newRow : undefined}>
                <td className={styles.entityCol}>
                  {item.entity}
                  {item.isNew && <span className={styles.newBadge}>NEW</span>}
                </td>
                <td className={styles.textCol}>{item.text}</td>
                <td className={styles.num}>{item.votes}</td>
                <td className={styles.date}>{formatDate(item.created_at)}</td>
                <td>
                  <select
                    className={styles.statusSelect}
                    aria-label={`Status for item ${item.id}`}
                    value={item.status}
                    onChange={(e) => changeStatus(item.id, e.target.value as Status)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={styles.notesCol}>
                  <div className={styles.notesRow}>
                    <textarea
                      className={styles.notesInput}
                      aria-label={`Notes for item ${item.id}`}
                      rows={2}
                      value={noteDrafts[item.id] ?? item.notes}
                      onChange={(e) =>
                        setNoteDrafts((d) => ({ ...d, [item.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className={styles.saveBtn}
                      aria-label={`Save notes for item ${item.id}`}
                      disabled={
                        noteDrafts[item.id] === undefined || noteDrafts[item.id] === item.notes
                      }
                      onClick={() => saveNotes(item.id)}
                    >
                      Save
                    </button>
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    aria-label={`Delete item ${item.id}`}
                    onClick={() => remove(item.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
