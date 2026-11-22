# Scrubs desktop app (Windows MSI)

Packages the backend and the frontend into one Windows app. Detection (Presidio, GLiNER, the BC lexicon) runs on the computer. The only network traffic is the pseudonymized text sent to Gemini.

Nothing in `backend/` is changed for this. `launcher.py` imports `backend/app.py` as it is.

## How it works

- `launcher.py` sets the environment, imports the Flask app, adds two routes that serve the static frontend, and starts it on a random port on `127.0.0.1`. It opens the page in a native window (pywebview, using Edge WebView2), or the default browser if that fails.
- The frontend is a static export (`STATIC_EXPORT=1 npx next build` → `.next-export/`) with `NEXT_PUBLIC_API_URL=/`, so page and API share one origin and there is no CORS.
- GLiNER is bundled as a self-contained folder (weights and tokenizer), so the app never contacts Hugging Face. `HF_HUB_OFFLINE=1` is forced.
- The lexicon comes from the bundled `data/lexicon_seed.csv`. Snowflake auditing is off unless `SNOWFLAKE_*` is set.
- The Gemini key is asked for on the app's first screen and stored in Windows Credential Manager (service "Scrubs"). It is never in the installer or a file. Settings (top right) replaces or removes it without a restart.
- Nothing is written to disk at runtime: no log file, no document cache. Closing the window clears everything.

## Build

Two things that break a first build on Windows:

- **Long paths.** PyTorch installs files nested deep enough to pass Windows' 260-character limit when the repo sits in a long folder. Build from a short path, for example `subst S: "<repo folder>"` and run everything from `S:\` (remove it afterwards with `subst S: /d`).
- **protobuf.** Loading GLiNER's tokenizer needs `protobuf>=7`. pip warns that `snowflake-connector-python` wants `<7`; that only matters if Snowflake auditing is configured, which the desktop app never does. Run `backend\.venv\Scripts\pip install -U "protobuf>=7"` after the install below.

PyInstaller also needs a few GB of free memory: close large apps while it runs.

Once, from the repo root:

```
py -3.11 -m venv backend\.venv
backend\.venv\Scripts\pip install -r requirements.txt pyinstaller waitress pywebview keyring
backend\.venv\Scripts\python -m spacy download en_core_web_sm
```

Download WiX Toolset v3 (`wix314-binaries.zip` from https://github.com/wixtoolset/wix3/releases) and unzip it into `desktop\build\tools\wix`.

Then:

```
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

Output:
- `desktop\dist\Scrubs\Scrubs.exe` (the app folder)
- `desktop\dist\Scrubs-0.1.0.msi` (the installer). Set `SCRUBS_VERSION` for a new version number; a higher version upgrades over the old one.

Options: `-Console` shows a console window with startup errors; `-SkipMsi` stops after the app folder.

The first build takes about 20 minutes (PyInstaller analysing torch, spaCy and transformers). Later builds reuse that analysis when only small things change.

## Test without a window

```
set SCRUBS_NO_WINDOW=1
desktop\dist\Scrubs\Scrubs.exe
```

It prints the local URL. Open it in a browser or call `/health`.

## Known limits

- Size: about 1.5 GB installed, mostly torch and the GLiNER weights.
- The MSI is not code-signed, so Windows SmartScreen shows "unknown publisher". Click "More info", then "Run anyway".
- The installer uses WiX's default wizard images.
- First launch takes a few seconds while GLiNER loads. It warms up in the background, so the first scan is usually ready by the time you upload.
