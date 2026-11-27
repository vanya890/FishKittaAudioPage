KITTA AUDIO CONSOLE — PORTABLE WINDOWS VERSION
================================================

This package runs the Kitta Audio Console locally on Windows.
It supports both Kitta Audio Open API and native Fish Audio API.
It does not require Node.js, npm, Python, Docker, an account on a hosting
platform, a domain name, router configuration, or administrator rights.

SYSTEM REQUIREMENTS
-------------------
- Windows 10 or Windows 11, 64-bit (x64).
- An ordinary internet connection to reach Kitta Audio.
- A modern browser (Microsoft Edge, Chrome, Firefox, etc.).

START
-----
1. Extract the entire ZIP archive to a normal folder.
   Do not launch start.bat from inside the ZIP preview.
2. Double-click start.bat.
3. Wait for the browser tab to open.
4. Click the API connection button in the top-right corner.
5. Select the provider: Kitta Audio or Native Fish Audio.
6. Paste the matching personal API key and click "Проверить и подключить".
7. Generate speech. The generated audio can be played and downloaded in the page.

For Fish Audio, use your native Fish API key (usually starts with sk-fish-). The app supports POST /v1/tts, Drama 3, S2 and S3 models, and an optional voice reference ID.

The server normally uses http://127.0.0.1:4173.
If that port is busy, it automatically tries the next ports up to 4199.
The actual address is printed in the console and opened in the browser.

STOP
----
Close the black console window or press Ctrl+C in it.
The application stops when the local server stops.

API KEY AND PRIVACY
-------------------
- The API key is kept in application memory only.
- It is not written to files, cookies, Local Storage, or Session Storage.
- The browser sends the key only to the local server on this computer.
- The local server forwards Kitta keys only to https://fishaudio.org and Fish keys only to https://api.fish.audio.
- The local server does not print, save, or intentionally log API keys or request bodies.
- The server binds to 127.0.0.1 and refuses requests from other computers.
- After refreshing the page or restarting the application, enter the key again.

Do not enter your API key on a shared or compromised computer.
Browser extensions and malware running on your own computer may still be able
to inspect browser activity. The key is your personal credential; do not share it.

COSTS
-----
The application itself is free and does not use a third-party hosting quota.
Kitta Audio may charge credits or apply API quotas according to your account.
Check your Kitta Audio balance before large generations.

TECHNICAL DETAILS
-----------------
The ZIP contains a portable Node.js 26.13.1 runtime for Windows x64.
Node.js is included so no separate installation is needed.
The local server uses only Node.js built-in modules; it downloads no npm packages.
The API hosts are fixed to https://fishaudio.org and https://api.fish.audio.
The server does not accept arbitrary upstream URLs. Fish Audio requests are
restricted to the wallet/package check and the native /v1/tts endpoint.

Node.js is a trademark of the OpenJS Foundation.
Node.js license text is included in runtime/LICENSE.txt.
