KITTA AUDIO CONSOLE — PORTABLE WINDOWS VERSION
================================================

This package runs the Kitta Audio Console locally on Windows.
It supports Kitta Audio Open API and the native Fish Audio API.
No separate Node.js, npm, Python, Docker, hosting account, domain,
router configuration, or administrator rights are required.

SYSTEM REQUIREMENTS
-------------------
- Windows 10 or Windows 11, 64-bit (x64).
- An internet connection to reach the selected API provider.
- A modern browser (Microsoft Edge, Chrome, Firefox, etc.).

START
-----
1. Extract the entire ZIP archive to a normal folder.
   Do not launch start.bat from inside the ZIP preview.
2. Double-click start.bat.
3. The local server starts on 127.0.0.1 and opens the page in your
   default browser automatically. If port 4173 is busy, the launcher
   selects the next available port through 4199.
4. Click the API connection control in the top-right corner.
5. Select Kitta Audio or Native Fish Audio.
6. Paste the matching personal API key and connect.

NATIVE FISH AUDIO FEATURES
--------------------------
- Voice cloning: create a permanent TTS voice model from 1–20 audio
  samples. You can provide matching transcripts, description, tags,
  optional cover art, enhanced audio, and a generated demo sample.
- Browse your own voice models, filter by visibility, select a model
  as a TTS reference, rename it, or delete it.
- REST TTS using S1, S2, S3 and Drama 3 models, with optional timestamped
  output and supported advanced request parameters.
- Multi-speaker TTS for supported models, using a JSON array of reference
  IDs and speaker tags in the text.
- Speech-to-Text with model and language selection.
- Voice Design preview generation from a text description.
- Audio Infill: replace part of an audio recording or join two clips
  with newly generated speech.
- Subscription and API-credit information.

Fish Voice Design candidates are preview samples, not saved voice models.
Use Voice Cloning to create a permanent model. Realtime WebSocket TTS/ASR
and MessagePack inline voice references are not included yet.

For Fish Audio, use your native Fish API key (usually starts with sk-fish-).
A Kitta key and a Fish key are different credentials.

VOICE CLONING RIGHTS
--------------------
Only clone a voice that you own or that you are authorized to use.
The application requires confirmation before uploading voice samples.

STOP
----
Close the black console window or press Ctrl+C in it.
The application stops when the local server stops.

API KEY AND PRIVACY
-------------------
- The API key is kept in application memory only.
- It is not written to files, cookies, Local Storage, or Session Storage.
- The browser sends the key only to the local server on this computer.
- Kitta keys are forwarded only to https://fishaudio.org.
- Native Fish keys are forwarded only to https://api.fish.audio.
- The local server does not intentionally log API keys or request bodies.
- The server binds to 127.0.0.1 and refuses requests from other computers.
- After refreshing the page or restarting the application, enter the key again.

Do not enter your API key on a shared or compromised computer.
Browser extensions and malware running on your own computer may still be
able to inspect browser activity. The key is your personal credential.

COSTS
-----
The application itself is free and does not use a third-party hosting quota.
Fish Audio and Kitta Audio may charge credits or apply API quotas according
to your account and the selected model. Check your API credit balance before
large generations or voice-cloning operations.

TECHNICAL DETAILS
-----------------
The ZIP contains a portable Node.js 26.13.1 runtime for Windows x64.
The local server uses only Node.js built-in modules; it downloads no npm
packages. The official runtime checksum is checked during package creation.

The API hosts are fixed to https://fishaudio.org and https://api.fish.audio.
The server does not accept arbitrary upstream URLs. Native Fish routes are
restricted to approved model, wallet, TTS, ASR, Voice Design and Audio Infill
endpoints.

Node.js is a trademark of the OpenJS Foundation.
Node.js license text is included in runtime/LICENSE.txt.
