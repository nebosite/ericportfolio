import { useEffect, useState, FormEvent } from "react";
import styles from "./Guestbook.module.css";

interface GuestbookEntry {
  id: number;
  name: string;
  message: string;
  created_at: string;
}

export default function Guestbook() {
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = () => {
    fetch("/api/guestbook")
      .then((res) => res.json())
      .then((data: GuestbookEntry[]) => setEntries(data))
      .catch(() => setError("Could not load the guestbook."));
  };

  useEffect(loadEntries, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !message.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/guestbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), message: message.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Something went wrong.");
      }
      setName("");
      setMessage("");
      loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.guestbook}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          type="text"
          placeholder="Your name"
          value={name}
          maxLength={50}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className={styles.input}
          type="text"
          placeholder="Besmirchment"
          value={message}
          maxLength={500}
          onChange={(e) => setMessage(e.target.value)}
          required
        />
        <button className={styles.button} type="submit" disabled={submitting}>
          {submitting ? "Besmirching…" : "Besmirch Fred Lefty, will you?"}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      <ul className={styles.entries}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.entry}>
            <span className={styles.entryName}>{entry.name}</span>
            <span className={styles.entryMessage}>{entry.message}</span>
            <span className={styles.entryDate}>
              {new Date(entry.created_at + "Z").toLocaleDateString()}
            </span>
          </li>
        ))}
        {entries.length === 0 && !error && (
          <li className={styles.empty}>No notes yet — be the first!</li>
        )}
      </ul>
    </div>
  );
}
