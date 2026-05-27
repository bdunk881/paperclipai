import { useState } from "react";
import { apiRequest } from "../../lib/apiClient";

interface Note {
  id: string;
  body: string;
  pinned: boolean;
  author_admin_id: string;
  created_at: string;
}

export function NotesTab({
  userId,
  notes,
  onChange,
}: {
  userId: string;
  notes: Note[];
  onChange: () => void;
}) {
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/admin-console/notes", {
        method: "POST",
        body: { user_id: userId, body, pinned },
      });
      setBody("");
      setPinned(false);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await apiRequest(`/api/admin-console/notes/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <>
      <div className="card">
        <h2>New note</h2>
        <div className="field">
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="row">
          <label>
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              style={{ width: "auto", marginRight: "0.25rem" }}
            />
            Pin to top
          </label>
          <button className="primary" disabled={busy || !body.trim()} onClick={create}>
            Save note
          </button>
        </div>
        {error && (
          <div className="banner danger" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Notes ({notes.length})</h2>
        {notes.length === 0 && <div className="muted">No notes yet.</div>}
        {notes.map((n) => (
          <div key={n.id} className="card" style={{ background: n.pinned ? "#fff8e1" : "#ffffff" }}>
            <div className="muted">
              {n.pinned && <span className="pill warning">pinned</span>} by{" "}
              <span className="code">{n.author_admin_id}</span> ·{" "}
              {new Date(n.created_at).toLocaleString()}
            </div>
            <pre style={{ whiteSpace: "pre-wrap", margin: ".5rem 0" }}>{n.body}</pre>
            <button onClick={() => remove(n.id)}>Delete</button>
          </div>
        ))}
      </div>
    </>
  );
}
