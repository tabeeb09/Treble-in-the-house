# Treble-in-the-house

Minimal local-LAN party game built with Next.js App Router, React, a custom Node server, and Socket.IO.

Players join on `/game`. A shared big-screen display runs on `/display`. Each round, players write lyric fragments, one player is secretly the imposter, a short song is generated from the final lyrics, and everyone votes on who the imposter is.

## Stack

- Next.js App Router
- React
- custom Node server in `server.js`
- Socket.IO
- schema-driven prompt/song system
- optional AI song generation with Google Lyria + Google Cloud Speech-to-Text
- deterministic mock AI mode for local development

## Requirements

- Node.js and npm
- same Wi-Fi / LAN for phones and laptop
- optional for real AI mode:
  - Google Cloud CLI (`gcloud`)
  - Gemini API key
  - Google Cloud project with Speech-to-Text enabled

## Install

```powershell
cd "C:\path\to\Treble-in-the-house"
npm install
```

## Run In Mock Mode

This is the easiest way to test locally. No API keys are needed.

```powershell
$env:MOCK_AI="true"
npm run dev
```

Then open:

- Display: `http://localhost:3000/display`
- Players: `http://localhost:3000/game`

For phones on the same network, use your laptop LAN IP:

- `http://<your-lan-ip>:3000/display`
- `http://<your-lan-ip>:3000/game`

## Windows Launchers

Double-click:

- `start-display-server.cmd`
  - starts the server
  - defaults to mock mode
  - opens `/display`

- `start-display-server-real.cmd`
  - loads your local secrets file if present
  - checks Google ADC login
  - starts real AI mode
  - opens `/display`

## Real AI Mode

Real AI mode uses:

- music generation: Google Lyria 3 Pro through the Gemini API
- alignment: Google Cloud Speech-to-Text

### 1. Create a local secret file

Copy:

- `local-secrets.example.cmd`

to:

- `local-secrets.cmd`

Then fill in your own values. `local-secrets.cmd` is gitignored.

Example:

```cmd
@echo off
set "MOCK_AI=false"
set "GEMINI_API_KEY=your_gemini_api_key_here"
set "GOOGLE_CLOUD_PROJECT=your-project-id"
set "LYRIA_MODEL=lyria-3-pro-preview"
set "MUSIC_PROVIDER=google-lyria"
set "ALIGNMENT_PROVIDER=google-cloud-stt"
```

### 2. Sign in to Google Cloud ADC

Run:

```powershell
gcloud auth application-default login
gcloud config set project your-project-id
gcloud auth application-default set-quota-project your-project-id
```

### 3. Start the app

Either:

- double-click `start-display-server-real.cmd`

or:

```powershell
cd "C:\path\to\Treble-in-the-house"
.\local-secrets.cmd
npm run dev
```

## Environment Variables

- `GEMINI_API_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_CLOUD_PROJECT`
- `MUSIC_PROVIDER`
- `ALIGNMENT_PROVIDER`
- `LYRIA_MODEL`
- `MOCK_AI`
- `GENERATED_AUDIO_DIR`
- `GENERATED_META_DIR`

Notes:

- `GOOGLE_APPLICATION_CREDENTIALS` is optional if you are using `gcloud auth application-default login`.
- all provider calls happen server-side only
- do not commit secrets

## Routes

- `/game`
  - participant client
  - one participant becomes master
  - players enter names, write prompts, and vote

- `/display`
  - shared screen
  - lobby, tutorial, round intro, writing countdown, AI generation state, lyric reveal, voting, round result, game over

## Gameplay Flow

1. Players join on `/game`
2. The first participant becomes master
3. The master starts the game
4. Players complete sequential prompt steps
5. One assigned player is the hidden imposter
6. Final lyric lines are assembled
7. The server generates a short song from those lines
8. The display plays the song and highlights the current lyric line
9. Players vote for the imposter
10. The game advances until lyricists win or lose

## Generated Files

Generated assets are stored locally under:

- `data/generated-audio/`
- `data/generated-meta/`

Each completed round can produce:

- the generated audio file
- metadata JSON with prompt, providers, word timings, and line timings

## Development Notes

- Mock mode is the intended default for development.
- If AI generation fails, the app still continues with a text-only lyric reveal.
- The display highlight is line-level only, not per-word karaoke coloring.

## Verify

```powershell
npm run build
```
