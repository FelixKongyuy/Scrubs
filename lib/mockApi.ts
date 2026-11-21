// In-browser mock of the backend API (CLAUDE.md section 10), used when NEXT_PUBLIC_USE_MOCK=1.
// Same request and response shapes as the real backend. Synthetic data only.

import { detect, makeDoc, seedDocs } from "./mockData";
import { ApiError, LOCKED_MSG } from "./errors";
import { containsTerm, mappingOf, pseudonymize, replaceAll, sentValue, wordCount } from "./text";
import type { ChatResponse, Doc, NewDocument, Settings } from "./types";

let store: Doc[] | null = null;
const db = () => (store ??= seedDocs().map(finalized));

// Stand-ins for the Snowflake tables. Decisions and counts only, never text.
const auditLog: unknown[] = [];
const outboundLog: unknown[] = [];

const CLINICIAN = "clinician";

const copy = <T,>(v: T): T => structuredClone(v);
const find = (id: string) => {
  const doc = db().find((d) => d.id === id);
  if (!doc) throw new ApiError("not_found", "This document is no longer in the demo. Scan it again.", 404);
  return doc;
};
const save = (doc: Doc) => {
  store = db().map((d) => (d.id === doc.id ? doc : d));
  return copy(doc);
};
function finalized(doc: Doc): Doc {
  return { ...doc, pseudonymized_text: pseudonymize(doc), status: "ready" };
}

// GET /documents
export async function listDocuments(): Promise<Doc[]> {
  return copy(db());
}

// GET /documents/{id}
export async function getDocument(id: string): Promise<Doc> {
  return copy(find(id));
}

// POST /documents
export async function createDocument(input: NewDocument): Promise<Doc> {
  if (input.kind === "pdf") throw new Error("PDF upload needs the backend. In this demo, paste the note text instead.");
  const flags = detect(input.text)
    .filter((f) => !isNeverMask(f.text))
    .map((f) => ({ ...f, locked: f.tier === "high" && !demoSettings.allow_high_override }));
  const doc = makeDoc(`doc-${Date.now()}`, input.title.trim() || "Pasted note", "paste", input.text, new Date(), flags);
  store = [doc, ...db()];
  return copy(doc);
}

// PATCH /documents/{id}/flags/{flag_code}
export async function setFlagMasked(id: string, flagCode: string, masked: boolean): Promise<Doc> {
  const doc = find(id);
  const flag = doc.flags.find((f) => f.flag_code === flagCode);
  if (!flag) throw new Error(`Flag ${flagCode} not found`);
  if (flag.locked) throw new ApiError("locked", LOCKED_MSG, 403);
  auditLog.push({
    document_id: id,
    flag_code: flagCode,
    label: flag.label,
    tier: flag.tier,
    default_masked: flag.tier !== "low",
    final_masked: masked,
    changed_by: CLINICIAN,
    changed_at: new Date().toISOString(),
  });
  return save({
    ...doc,
    status: "needs_review",
    pseudonymized_text: null,
    flags: doc.flags.map((f) => (f.flag_code === flagCode ? { ...f, masked } : f)),
  });
}

// POST /documents/{id}/finalize
export async function finalizeDocument(id: string): Promise<Doc> {
  return save(finalized(find(id)));
}

// GET /documents/{id}/mapping
export async function getMapping(id: string): Promise<Record<string, string>> {
  return mappingOf(find(id));
}

// POST /chat
export async function chat(documentIds: string[], message: string): Promise<ChatResponse> {
  const docs = documentIds.map(find).filter((d) => d.status === "ready");
  const masked = docs.flatMap((d) => d.flags.filter((f) => f.masked));
  const safeMessage = replaceAll(message, masked.map((f) => [f.text, f.pseudonym]));

  const outbound_text = [
    ...docs.map((d, i) => `Document ${i + 1}:\n${d.pseudonymized_text}`),
    `Request: ${safeMessage}`,
  ].join("\n\n");

  // Leak check: no original value of a masked item may appear in what we send.
  const identifier_count = masked.filter((f) => containsTerm(outbound_text, f.text)).length;
  if (identifier_count > 0) {
    return { answer_with_pseudonyms: "", outbound_text, identifier_count };
  }

  outboundLog.push({ document_ids: documentIds, word_count: wordCount(outbound_text), identifier_count, model: "gemini", sent_at: new Date().toISOString() });
  await new Promise((r) => setTimeout(r, 900));
  return { answer_with_pseudonyms: mockAnswer(docs, message), outbound_text, identifier_count };
}

// The demo's chatbot is canned, so it starts with a key "set" and never needs a real one.
let demoSettings: Settings = {
  gemini_key_set: true,
  gemini_key_hint: null,
  key_storage: "demo",
  never_mask: [],
  allow_high_override: false,
};

// PUT /settings/high-override. Same rules as the backend: unlock HIGH flags, or mask and relock them.
export async function saveHighOverride(enabled: boolean): Promise<Settings> {
  demoSettings = { ...demoSettings, allow_high_override: enabled };
  let changed = 0;
  store = db().map((d) => {
    let touched = false;
    const flags = d.flags.map((f) => {
      if (f.tier !== "high") return f;
      if (!enabled && !f.masked) touched = true;
      return { ...f, locked: !enabled, masked: enabled ? f.masked : true };
    });
    if (!touched) return { ...d, flags };
    changed++;
    return { ...d, flags, status: "needs_review", pseudonymized_text: null };
  });
  return { ...demoSettings, documents_updated: changed };
}

const normalizePhrase = (w: string) => w.replace(/\s+/g, " ").trim().replace(/^[.,;:!?"'()[\]]+|[.,;:!?"'()[\]]+$/g, "").toLowerCase();
const isNeverMask = (text: string) => demoSettings.never_mask.some((w) => normalizePhrase(w) === normalizePhrase(text));

// PUT /settings/never-mask. Same rules as the backend: dedupe, then drop matching flags from open documents.
export async function saveNeverMask(words: string[]): Promise<Settings> {
  const seen = new Set<string>();
  const clean = words
    .map((w) => w.replace(/\s+/g, " ").trim())
    .filter((w) => w && !seen.has(normalizePhrase(w)) && seen.add(normalizePhrase(w)));
  demoSettings = { ...demoSettings, never_mask: clean };
  let changed = 0;
  store = db().map((d) => {
    const kept = d.flags.filter((f) => !isNeverMask(f.text));
    if (kept.length === d.flags.length) return d;
    changed++;
    return { ...d, flags: kept, status: "needs_review", pseudonymized_text: null };
  });
  return { ...demoSettings, documents_updated: changed };
}

// GET /settings
export async function getSettings(): Promise<Settings> {
  return { ...demoSettings };
}

// PUT /settings/gemini-key. Nothing is checked or kept: this is the public demo.
export async function saveGeminiKey(key: string): Promise<Settings> {
  const k = key.trim();
  if (!k) throw new ApiError("server", "Paste your Gemini API key.", 400);
  demoSettings = { ...demoSettings, gemini_key_set: true, gemini_key_hint: k.length >= 8 ? k.slice(-4) : null };
  return { ...demoSettings, verified: false };
}

// DELETE /settings/gemini-key
export async function removeGeminiKey(): Promise<Settings> {
  demoSettings = { ...demoSettings, gemini_key_set: false, gemini_key_hint: null };
  return { ...demoSettings };
}

// Canned Gemini answers, written only from what Gemini would have received.
function mockAnswer(docs: Doc[], message: string): string {
  if (docs.length === 0) return "No documents are selected.";
  const facts = (doc: Doc) => {
    const by = (label: string) => doc.flags.filter((f) => f.label === label).map(sentValue);
    const unique = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()))].map((x) => xs.find((y) => y.toLowerCase() === x)!);
    const people = doc.flags.filter((f) => f.label === "Person").map(sentValue);
    const doses = by("Dose");
    return {
      patient: people[0] ?? "the patient",
      provider: people.find((p) => p.startsWith("[PROVIDER")) ?? people[1] ?? "the referring physician",
      date: by("Date")[0],
      diagnoses: unique(by("Diagnosis")).join(", ") || "none recorded",
      meds: unique(by("Drug")).map((d, i) => (doses[i] ? `${d} ${doses[i]}` : d)).join(", ") || "none recorded",
    };
  };
  const q = message.toLowerCase();

  if (q.includes("referral")) {
    const f = facts(docs[0]);
    return `Dear Cardiology colleague,

I am referring ${f.patient} for assessment of ${f.diagnoses}.${f.date ? ` The patient was seen on ${f.date}.` : ""}

Current medications: ${f.meds}.

I would value your advice on ongoing management, including anticoagulation and rate or rhythm control. I plan to see the patient again in 2 weeks.

Sincerely,
${f.provider}`;
  }

  return docs
    .map((doc) => {
      const f = facts(doc);
      if (q.includes("discharge")) {
        return `Discharge summary\n\nPatient: ${f.patient}\nDiagnoses: ${f.diagnoses}\nMedications: ${f.meds}\n\nPlan: continue current medications as documented and keep the scheduled follow-up. Seek urgent care for chest pain, fainting, or new bleeding.`;
      }
      if (q.includes("handoff") || q.includes("hand-off")) {
        return `Handoff note\n\nPatient: ${f.patient}\nActive problems: ${f.diagnoses}\nMedications: ${f.meds}\nFollow-up owner: ${f.provider}`;
      }
      return `${f.patient}: diagnoses ${f.diagnoses}. Medications ${f.meds}.`;
    })
    .join("\n\n");
}
