"use client";

import type { Settings } from "../../lib/types";
import ApiKeyForm from "./ApiKeyForm";

type Props = {
  onSaved: (settings: Settings) => void;
  onSkip: () => void;
};

// First screen when no Gemini key is set yet (for example, right after installing).
export default function KeySetup({ onSaved, onSkip }: Props) {
  return (
    <section className="panel setup">
      <div className="panel__body">
        <p>
          Scrubs uses Google Gemini for its chatbot. Detection and review run on this computer and work without a
          key. Gemini only ever receives the pseudonymized text, never the original document.
        </p>
        <ApiKeyForm onSaved={onSaved} submitLabel="Save and continue" autoFocus />
        <p className="muted setup__skip">
          <button type="button" className="link-btn" onClick={onSkip}>
            Skip for now
          </button>{" "}
          You can add or change the key any time in Settings.
        </p>
      </div>
    </section>
  );
}
