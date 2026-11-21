// Shapes mirror the Flask responses in CLAUDE.md section 10.

export type Tier = "high" | "med" | "low";

export type Flag = {
  flag_code: string; // "F1"
  start_idx: number;
  end_idx: number;
  text: string;
  label: string; // "Location description"
  tier: Tier;
  reason: string;
  masked: boolean;
  locked: boolean;
  // What replaces the text when masked: "[LOC_01]", or a shifted date.
  pseudonym: string;
  // Which pass found it. Shown in Review so the demo can point at our model.
  source: "presidio" | "model" | "lexicon";
};

export type Doc = {
  id: string;
  title: string;
  source: "pdf" | "paste";
  original_text: string;
  pseudonymized_text: string | null;
  status: "needs_review" | "ready";
  created_at: string;
  flags: Flag[];
};

export type ChatResponse = {
  answer_with_pseudonyms: string;
  outbound_text: string;
  identifier_count: number;
  // Optional: why the leak check held the message back.
  blocked_reason?: string;
};

export type NewDocument = { kind: "pdf"; file: File } | { kind: "paste"; title: string; text: string };

// GET /settings. The key itself never comes back, only whether one is set and its last 4 characters.
export type Settings = {
  gemini_key_set: boolean;
  gemini_key_hint: string | null;
  // Where a saved key is kept: Windows Credential Manager (desktop app), this session only, or the demo.
  key_storage: "credential_manager" | "memory" | "demo";
  // Words and phrases the user told Scrubs never to mask (exact match, any case).
  never_mask: string[];
  // Only on PUT /settings/gemini-key: false when Google couldn't be reached to check the key.
  verified?: boolean;
  // Only on PUT /settings/never-mask: how many open documents changed and need another review.
  documents_updated?: number;
};
