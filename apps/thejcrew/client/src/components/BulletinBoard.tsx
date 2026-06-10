import { useEffect, useState, FormEvent } from 'react';
import styles from './BulletinBoard.module.css';

const EMOJIS = ['👍', '❤️', '😂'] as const;
const MAX_MESSAGE = 280;

interface Post {
  id: number;
  author: string;
  message: string;
  created_at: string;
  reactions: Record<string, number>;
}

function relativeTime(sqliteUtc: string): string {
  // SQLite CURRENT_TIMESTAMP is UTC without a timezone marker
  const then = new Date(sqliteUtc + 'Z').getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

export default function BulletinBoard() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [author, setAuthor] = useState('');
  const [message, setMessage] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/bulletin')
      .then((res) => res.json())
      .then((data: Post[]) => setPosts(data))
      .catch(() => setError('Could not load the bulletin board.'));
  }, []);

  const handlePost = async (e: FormEvent) => {
    e.preventDefault();
    if (!author.trim() || !message.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch('/api/bulletin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: author.trim(), message: message.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Something went wrong.');
      }
      const post = (await res.json()) as Post;
      setPosts((prev) => [post, ...prev].slice(0, 20));
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setPosting(false);
    }
  };

  const handleReact = async (postId: number, emoji: string) => {
    try {
      const res = await fetch(`/api/bulletin/${postId}/react`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as { id: number; reactions: Record<string, number> };
      setPosts((prev) =>
        prev.map((p) => (p.id === updated.id ? { ...p, reactions: updated.reactions } : p)),
      );
    } catch {
      // a missed reaction is not worth alarming the family over
    }
  };

  return (
    <div>
      <form className={styles.form} onSubmit={handlePost}>
        <input
          className={styles.input}
          type="text"
          placeholder="Who's writing?"
          value={author}
          maxLength={50}
          onChange={(e) => setAuthor(e.target.value)}
          required
        />
        <textarea
          className={styles.textarea}
          placeholder="What's the news?"
          value={message}
          maxLength={MAX_MESSAGE}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          required
        />
        <div className={styles.formRow}>
          <span className={styles.charCount}>
            {message.length}/{MAX_MESSAGE}
          </span>
          <button className={styles.postButton} type="submit" disabled={posting}>
            {posting ? 'Pinning…' : 'Pin to the board'}
          </button>
        </div>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      <ul className={styles.feed}>
        {posts.map((post) => (
          <li key={post.id} className={styles.post}>
            <div className={styles.postHeader}>
              <span className={styles.author}>{post.author}</span>
              <span className={styles.time}>{relativeTime(post.created_at)}</span>
            </div>
            <p className={styles.message}>{post.message}</p>
            <div className={styles.reactions}>
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={styles.reactionButton}
                  onClick={() => handleReact(post.id, emoji)}
                >
                  {emoji} {post.reactions[emoji] > 0 && <span>{post.reactions[emoji]}</span>}
                </button>
              ))}
            </div>
          </li>
        ))}
        {posts.length === 0 && !error && (
          <li className={styles.empty}>The board is empty — pin the first note!</li>
        )}
      </ul>
    </div>
  );
}
