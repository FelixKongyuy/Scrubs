"use client";

import { useState } from "react";
import { GEMINI_KEY_URL, saveGeminiKey } from "../../lib/api";
import { errorText } from "../../lib/errors";
import type { Settings } from "../../lib/types";

type Props = {
  onSaved: (settings: Settings) => void;
  submitLabel?: string;
  autoFocus?: boolean;
};

// Paste a Gemini API key and save it. The backend checks it with Google and keeps it on this
// computer. The key is never shown again after saving, only its last 4 characters.
export default function ApiKeyForm({ onSaved, submitLabel = "Save key", autoFocus }: Props) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!key.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const settings = await saveGeminiKey(key);
      setKey("");
      onSaved(settings);
    } catch (err) {
      setError(errorText(err, "The key couldn't be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="field">
        <span className="field__label">Gemini API key</span>
        <span className="key-input">
          <input
            className="input mono"
            type={show ? "text" : "password"}
            value={key}
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your key"
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="button" className="btn btn--sm" onClick={() => setShow((s) => !s)}>
            {show ? "Hide" : "Show"}
          </button>
        </span>
      </label>
      <p className="muted key-help">
        Don&apos;t have one?{" "}
        <a href={GEMINI_KEY_URL} target="_blank" rel="noreferrer">
          Create a free key in Google AI Studio
        </a>
        , then copy it here.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button type="submit" className="btn btn--primary" disabled={!key.trim() || saving}>
          {saving ? "Checking key…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
