# Scrubs

People paste private paperwork into chatbots to get it explained: medical records, letters from a clinic, bills, bank and tax forms. Scrubs lets you do that without the chatbot learning who you are.

You upload a PDF or paste the text. Scrubs flags the personal details (names, health card, SIN, bank and card numbers, addresses, dates and indirect clues), you check them, and the ones you mask are swapped for placeholders like `[PERSON_01]`. Only that version goes to Gemini. When the answer comes back, the real words are put back in on your screen.

We built it at StormHacks 2026 (Armin, Felix, Krish and Nathan) as a tool for clinicians. This fork is for anyone handling their own personal or medical documents.

## Get started (Windows)

Setting up takes about 10 minutes. You need a Windows computer, an internet connection and a Google account.

### Step 1: Download and install Scrubs

1. Download the installer: **[Scrubs-0.1.0.msi](https://github.com/FelixKongyuy/Scrubs/releases/latest/download/Scrubs-0.1.0.msi)** (about 930 MB). It's a big file, so it can take a few minutes.
2. Open the file you downloaded. It's usually in your **Downloads** folder.
3. Windows may show a blue box that says **"Windows protected your PC"**. This appears for small free apps that aren't registered with Microsoft. Click **More info**, then **Run anyway**.
4. Click **Next** on each screen, keep the suggested folder, then click **Install**. If Windows asks *"Do you want to allow this app to make changes?"*, click **Yes**.
5. When it finishes, leave **Open Scrubs** ticked and click **Finish**.

The first time, Scrubs shows "Starting Scrubs" for up to a minute while it gets ready. After that, open it from the Start menu like any other app.

![Installing Scrubs with the setup wizard](docs/releasetutorial.gif)

### Step 2: Get a free Gemini API key

Scrubs uses Google's Gemini to answer your questions. An **API key** is a long password that lets Scrubs use Gemini for you. It's free.

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** and sign in with your Google account.
2. Click **Create API key**. If it asks you to pick a project, the one it suggests is fine.
3. Click **Copy** next to your new key. It's a long line of letters and numbers that starts with `AIza`.

Keep your key private, like a password. Don't post it or share it.

### Step 3: Add the key to Scrubs

1. Scrubs opens on a screen called **Set up the chatbot**.
2. Click in the **Gemini API key** box and paste your key (**Ctrl + V**).
3. Click **Save and continue**. Scrubs checks the key with Google. If it says the key was rejected, copy it again and make sure nothing was left out.

That's it. Your key is saved securely on this computer, so you won't be asked again. To change or remove it later, click **Settings** in the top right corner.

Don't have a key yet? Click **Skip for now**. You can still upload and check documents; only the chatbot needs the key.

### Using Scrubs

1. **Upload** a PDF, or paste the text of a letter, form or record.
2. **Check** the highlighted items. Highlighted words are hidden from the chatbot. Click one to change it.
3. Click **Continue** and **ask** your question, for example "Explain this letter in simple words."

The chatbot only ever sees the hidden version (like `[PERSON_01]` instead of your name). Your real details are put back on your screen, never sent. Your documents stay on your computer and are cleared when you close Scrubs.

### Uninstalling

Open **Settings > Apps > Installed apps**, find **Scrubs**, and click **Uninstall**.

## How it works

1. Upload a text-based PDF or paste the text.
2. Scrubs looks for identifiers in three ways. Presidio handles the standard ones and we added Canadian rules to it (BC PHN and SIN check digits, card and bank numbers, postal codes, MRNs, prescriber numbers). Common abbreviations like VHDL or CRA are never treated as names. GLiNER, a small local model, catches indirect ones like "the retired town pharmacist". A list of BC towns, facilities and job titles catches the rest.
3. You review the flags. HIGH items (names, ID numbers, addresses) are always masked, unless you add a word Scrubs flagged by mistake to **Settings > Never mask**. MED items (exact dates, small towns, employers) are masked unless you unmask them. LOW items (drugs, doses, diagnoses) are kept unless you mask them. Click any highlight to change it.
4. You chat. Ask questions about your documents, or ask for a summary or a draft. Gemini only gets the placeholders. Dates are moved by the same number of days, so the gaps between them stay right.

Documents, flags and the placeholder mapping are kept in memory only and are gone when you restart. The one exception is the optional Snowflake audit log, which records mask and unmask decisions as counts with no document text.

## Running it locally

Backend, using Python 3.11:

```
py -3.11 -m venv backend\.venv
backend\.venv\Scripts\pip install -r requirements.txt
backend\.venv\Scripts\python -m spacy download en_core_web_sm
copy .env.example .env
cd backend
.venv\Scripts\python app.py
```

Put your `GEMINI_API_KEY` in `.env`, or add it from **Settings** in the app (a key added there lasts until the backend restarts). The API runs on http://127.0.0.1:5000.

Frontend, in a second terminal from the repo root:

```
npm install
npm run dev
```

It runs on http://localhost:3000. To try the frontend with sample data and no backend, set `NEXT_PUBLIC_USE_MOCK=1` in `.env`.

## Where things are

| Path | What's there |
|---|---|
| `app/`, `lib/` | Next.js frontend |
| `backend/` | Flask API, with the detection code in `backend/pipeline/` |
| `desktop/` | Windows app and MSI build, see [desktop/README.md](desktop/README.md) |
| `eval/` | Synthetic test notes and `eval/run.py`, which scores default Presidio against our pipeline, see [eval/README.md](eval/README.md) |
| `data/` | Seed copy of the sensitive terms database, and sample PDFs |

## Sponsor tracks

- Gemini API runs the chat, and only ever sees masked text.
- A bundled list of known sensitive terms that are easy to miss or ambiguous, like small towns, facilities and identifying job titles, is matched locally.
- Python: the whole backend is Python, including detection (Presidio, GLiNER), masking, date shifting and the Flask API.

## Limits

This is a hackathon prototype and hasn't been validated for clinical use. Check the flagged items yourself before you send anything.
