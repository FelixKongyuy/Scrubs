"use client";

import { useEffect, useRef, useState } from "react";
import TierTag from "./TierTag";

export default function HowItWorks() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="popover" ref={ref}>
      <button
        type="button"
        className="masthead__link"
        aria-expanded={open}
        aria-controls="how-it-works"
        onClick={() => setOpen((o) => !o)}
      >
        How it works
      </button>
      {open && (
        <div id="how-it-works" className="panel popover__panel" role="dialog" aria-label="How it works">
          <div className="popover__head">
            <h2>What happens when you scan</h2>
            <button type="button" className="link-btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <p className="muted">
            Scrubs works with any private document: medical records, letters, bills, bank or tax forms. It hides
            the details that point to you before anything is sent to the chatbot.
          </p>
          <ol className="steps-list">
            <li>Scrubs finds names, ID numbers (health card, SIN, bank and card numbers), addresses, phone numbers and dates.</li>
            <li>It also looks for clues that could point to you indirectly, like a small town or &ldquo;the retired town pharmacist&rdquo;.</li>
            <li>You check every flagged item and decide what to hide.</li>
            <li>Hidden items are swapped for labels like [PERSON_01]. Only that version goes to the chatbot, and the real words are put back on your screen.</li>
          </ol>
          <h2 className="side-h">How items are sorted</h2>
          <dl className="tier-legend">
            <dt>
              <TierTag tier="high" />
            </dt>
            <dd>Always hidden. Names, ID numbers, addresses, phone numbers, emails.</dd>
            <dt>
              <TierTag tier="med" />
            </dt>
            <dd>Hidden unless you choose to keep them. Exact dates, towns, employers, job titles, family details.</dd>
            <dt>
              <TierTag tier="low" />
            </dt>
            <dd>Kept unless you choose to hide them. Medical terms like medications, doses and diagnoses.</dd>
          </dl>
          <p className="muted">
            Something flagged by mistake, like a course name? Add it under Settings &gt; Never mask.
          </p>
          <h2 className="side-h">Your documents stay on this computer</h2>
          <p className="muted">
            Documents, flagged items and the real words behind each label are only kept in memory while Scrubs is
            open. They are never saved to disk, and they are cleared when you close the app.
          </p>
        </div>
      )}
    </div>
  );
}
