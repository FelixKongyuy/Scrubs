"use client";

import { useEffect, useRef, useState } from "react";
import { removeGeminiKey, saveNeverMask } from "../../lib/api";
import { errorText } from "../../lib/errors";
import type { Settings } from "../../lib/types";
import ApiKeyForm from "./ApiKeyForm";

type Props = {
  settings: Settings | null;
  onChange: (settings: Settings) => void;
  // Called after the never-mask list changes, so open documents are reloaded.
  onDocumentsChanged: () => void;
  onClose: () => void;
};

const updatedText = (n: number | undefined) =>
  n ? ` ${n} open document${n === 1 ? " was" : "s were"} updated: review ${n === 1 ? "it" : "them"} again before chatting.` : "";

// Words Scrubs flagged by mistake (course names, acronyms, product names). They are never masked,
// in any tier, so they reach the chatbot as written.
function NeverMaskList({
  words,
  onSaved,
}: {
  words: string[];
  onSaved: (settings: Settings, message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string[], message: string) => {
    setBusy(true);
    setError(null);
    try {
      const s = await saveNeverMask(next);
      onSaved(s, message + updatedText(s.documents_updated));
      return true;
    } catch (err) {
      setError(errorText(err, "The list couldn't be saved."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const w = draft.trim();
    if (!w || busy) return;
    if (words.some((x) => x.toLowerCase() === w.toLowerCase())) {
      setDraft("");
      return;
    }
    if (await save([...words, w], `"${w}" will no longer be masked.`)) setDraft("");
  };

  return (
    <>
      <h3 className="side-h">Never mask</h3>
      <p className="muted">
        Words Scrubs flagged by mistake, like a course name or an abbreviation. They are never masked, even HIGH
        items, and are sent to the chatbot as written. Only add things that don&apos;t identify you.
      </p>
      <form
        className="never-mask__add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="sr-only" htmlFor="never-mask-input">
          Word or phrase to never mask
        </label>
        <input
          id="never-mask-input"
          className="input"
          value={draft}
          maxLength={100}
          placeholder="For example: VHDL"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!draft.trim() || busy}>
          Add
        </button>
      </form>
      {words.length === 0 ? (
        <p className="muted never-mask__empty">Nothing on the list yet.</p>
      ) : (
        <ul className="never-mask__list">
          {words.map((w) => (
            <li key={w}>
              <span>{w}</span>
              <button
                type="button"
                className="link-btn"
                disabled={busy}
                aria-label={`Remove ${w}`}
                onClick={() => save(words.filter((x) => x !== w), `"${w}" will be flagged again in new scans.`)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const STORAGE_TEXT: Record<Settings["key_storage"], string> = {
  credential_manager: "Saved in Windows Credential Manager on this computer.",
  memory: "Kept until Scrubs restarts. Add GEMINI_API_KEY to .env to keep it.",
  demo: "Demo mode: the chatbot is simulated, so no key is needed.",
};

export default function SettingsDialog({ settings, onChange, onDocumentsChanged, onClose }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const remove = async () => {
    setRemoving(true);
    setError(null);
    setNote(null);
    try {
      onChange(await removeGeminiKey());
      setNote("Key removed. The chatbot is off until you add a key.");
    } catch (err) {
      setError(errorText(err, "The key couldn't be removed."));
    } finally {
      setRemoving(false);
    }
  };

  const keySet = settings?.gemini_key_set ?? false;

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className="panel modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
      >
        <div className="popover__head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="link-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <h3 className="side-h">Gemini API key</h3>
        {settings === null ? (
          <p className="muted">Can&apos;t reach Scrubs&apos; backend right now, so the key can&apos;t be changed.</p>
        ) : (
          <>
            <p className="key-status">
              {keySet ? (
                <>
                  <strong>Key set</strong>
                  {settings.gemini_key_hint && <span className="mono"> ending in {settings.gemini_key_hint}</span>}
                </>
              ) : (
                <strong>No key set. The chatbot is off.</strong>
              )}
            </p>
            <p className="muted">{STORAGE_TEXT[settings.key_storage]}</p>

            <ApiKeyForm
              submitLabel={keySet ? "Replace key" : "Save key"}
              onSaved={(s) => {
                onChange(s);
                setError(null);
                setNote(
                  s.verified === false
                    ? "Key saved. Google couldn't be reached to check it, so it will be checked on your first chat."
                    : "Key saved and checked with Google.",
                );
              }}
            />

            {keySet && settings.key_storage !== "demo" && (
              <div className="actions">
                <button type="button" className="link-btn" disabled={removing} onClick={remove}>
                  {removing ? "Removing…" : "Remove key from this computer"}
                </button>
              </div>
            )}

            <NeverMaskList
              words={settings.never_mask}
              onSaved={(s, message) => {
                onChange(s);
                onDocumentsChanged();
                setError(null);
                setNote(message);
              }}
            />
          </>
        )}

        {note && (
          <p className="key-note" role="status">
            {note}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
