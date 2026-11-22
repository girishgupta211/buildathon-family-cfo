# Kutumb, local version with Sarvam voice input

1. Install Node 20 or newer (https://nodejs.org) if you do not have it.
2. In this folder run:  node server.js
3. Open http://localhost:3000 in Chrome, Edge or Safari. Allow the microphone when asked.

The Sarvam key is in the `.env` file. It stays on your computer; the page never sees it.
Do not share this folder or upload it anywhere with `.env` inside. Revoke the key in the Sarvam dashboard if it was ever shared.

What uses Sarvam
- Speech to text: model saaras:v3, language auto-detected
- Turning what was said into family, income, goals and holdings: model sarvam-30b
# hacathone
