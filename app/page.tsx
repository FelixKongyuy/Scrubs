"use client";

import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { ApiError, errorText } from "../lib/errors";
import type { Doc, Flag, NewDocument, Settings } from "../lib/types";
import ChatStep, { type ChatMessage } from "./components/ChatStep";
import KeySetup from "./components/KeySetup";
import Loading from "./components/Loading";
import ReviewStep from "./components/ReviewStep";
import SettingsDialog from "./components/SettingsDialog";
import Shell, { type Notice, type Step } from "./components/Shell";
import UploadStep from "./components/UploadStep";

const SCAN_STEPS = ["Reading the document", "First pass: identifying details", "Second pass: identifying details", "Preparing items for review"];
const FINALIZE_STEPS = ["Pseudonymizing", "Shifting dates", "Keeping the mapping in memory only"];

const HEADINGS: Record<Step, [string, string]> = {
  upload: ["Upload a document", ""],
  review: ["Review redactions", ""],
  chat: ["Ask the chatbot", ""],
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Home() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [step, setStepState] = useState<Step>("upload");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [chatIds, setChatIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState<{ title: string; steps: string[] } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  // Gemini key status. null = not loaded yet, or the backend couldn't be reached.
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsChecked, setSettingsChecked] = useState(false);
  const [skippedSetup, setSkippedSetup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch(() => setSettings(null))
      .finally(() => setSettingsChecked(true));
  }, []);

  // Ask for the key at startup until one is saved (or the user skips for this session).
  const needsSetup = settingsChecked && settings !== null && !settings.gemini_key_set && !skippedSetup;
  // Unknown (backend unreachable) counts as set: the chat request then explains what's wrong.
  const keySet = settings === null || settings.gemini_key_set;

  const setStep = (s: Step) => {
    setNotice(null);
    setStepState(s);
  };

  const loadDocs = () => {
    setNotice(null);
    api
      .listDocuments()
      .then(setDocs)
      .catch((e) => setNotice({ text: errorText(e), retry: loadDocs }));
  };

  useEffect(loadDocs, []);

  const current = docs.find((d) => d.id === currentId) ?? null;
  const readyDocs = docs.filter((d) => d.status === "ready");

  const upsert = (doc: Doc) =>
    setDocs((ds) => (ds.some((d) => d.id === doc.id) ? ds.map((d) => (d.id === doc.id ? doc : d)) : [doc, ...ds]));

  const withLoading = async <T,>(title: string, steps: string[], work: Promise<T>) => {
    setLoading({ title, steps });
    try {
      const [result] = await Promise.all([work, wait(steps.length * 400 + 300)]);
      return result;
    } finally {
      setLoading(null);
    }
  };

  const scan = async (input: NewDocument) => {
    setScanError(null);
    setNotice(null);
    try {
      const doc = await withLoading("Scanning document", SCAN_STEPS, api.createDocument(input));
      upsert(doc);
      setCurrentId(doc.id);
      setStep("review");
    } catch (err) {
      setScanError(errorText(err, "Scanning failed."));
    }
  };

  const setMasked = async (flag: Flag, masked: boolean) => {
    if (!current) return;
    const id = current.id;
    setNotice(null);
    try {
      upsert(await api.setFlagMasked(id, flag.flag_code, masked));
    } catch (err) {
      setNotice({ text: errorText(err) });
      // Show the backend's real state after a rejected change.
      if (err instanceof ApiError && err.kind === "locked") api.getDocument(id).then(upsert).catch(() => {});
    }
  };

  // One request at a time, so each response is the latest state of the document.
  const setMany = async (changes: [Flag, boolean][]) => {
    if (!current) return;
    setNotice(null);
    try {
      for (const [f, masked] of changes) upsert(await api.setFlagMasked(current.id, f.flag_code, masked));
    } catch (err) {
      setNotice({ text: errorText(err) });
    }
  };

  const reset = () => {
    if (!current) return;
    setMany(current.flags.filter((f) => !f.locked && f.masked !== (f.tier !== "low")).map((f) => [f, f.tier !== "low"]));
  };

  const finish = async () => {
    if (!current) return;
    setNotice(null);
    try {
      const doc = await withLoading("Preparing for chat", FINALIZE_STEPS, api.finalizeDocument(current.id));
      upsert(doc);
      setChatIds((ids) => (ids.includes(doc.id) ? ids : [...ids, doc.id]));
      setStep("chat");
    } catch (err) {
      setNotice({ text: errorText(err) });
    }
  };

  const openReview = (doc: Doc) => {
    setCurrentId(doc.id);
    setStep("review");
  };

  // "Not private? Never mask" on a locked item: add it to the Settings list, then reload every
  // document, because the backend drops that word from all of them.
  const neverMask = async (text: string) => {
    try {
      const s = await api.saveNeverMask([...(settings?.never_mask ?? []), text]);
      setSettings(s);
      loadDocs();
    } catch (err) {
      setNotice({ text: errorText(err) });
    }
  };

  // Until the key status is known, show only the header, so the upload page never flashes first.
  const [title, subtitle] = !settingsChecked ? ["", ""] : needsSetup ? ["Set up the chatbot", ""] : HEADINGS[step];

  return (
    <Shell
      step={step}
      enabled={{ upload: true, review: current !== null, chat: readyDocs.length > 0 }}
      onSelect={setStep}
      title={title}
      subtitle={subtitle}
      alert={notice}
      onOpenSettings={() => setShowSettings(true)}
      hideSteps={!settingsChecked || needsSetup}
    >
      {showSettings && (
        <SettingsDialog
          settings={settings}
          onChange={setSettings}
          onDocumentsChanged={loadDocs}
          onClose={() => setShowSettings(false)}
        />
      )}
      {!settingsChecked ? null : needsSetup ? (
        <KeySetup onSaved={setSettings} onSkip={() => setSkippedSetup(true)} />
      ) : loading ? (
        <Loading title={loading.title} steps={loading.steps} />
      ) : step === "review" && current ? (
        <ReviewStep
          doc={current}
          onSetMasked={setMasked}
          onSetMany={setMany}
          onReset={reset}
          onBack={() => setStep("upload")}
          onDone={finish}
          onNeverMask={neverMask}
          highOverride={settings?.allow_high_override ?? false}
        />
      ) : step === "chat" ? (
        <ChatStep
          readyDocs={readyDocs}
          selectedIds={chatIds}
          setSelectedIds={setChatIds}
          messages={messages}
          setMessages={setMessages}
          onAddDocument={() => setStep("upload")}
          onReview={openReview}
          keySet={keySet}
          onOpenSettings={() => setShowSettings(true)}
        />
      ) : (
        <UploadStep onScan={scan} error={scanError} />
      )}
    </Shell>
  );
}
