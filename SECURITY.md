# Security policy

## API credentials

- Never commit Kitta Audio API keys, Cloudflare secrets, access tokens, or real user credentials.
- GitHub Pages is public. Repository files and the deployed JavaScript must be treated as public.
- The direct browser mode is explicitly experimental and not recommended for valuable API keys. The key exists in page memory while the tab is open; it is not written to Local Storage, Session Storage, cookies, URLs, or logs. Reloading the page clears it.
- Prefer the optional server-side proxy in worker/. Protect that Worker with Cloudflare Access, restrict its access policy to the intended account, configure the exact Pages origin, and keep KITTA_API_KEY as a Worker secret.
- The Worker validates Cloudflare Access JWT signatures and audience before forwarding API requests. Do not deploy it without Access protection and valid ACCESS_TEAM_DOMAIN / ACCESS_AUD values.

## Reporting a vulnerability

Do not publish API keys or personal recordings in an issue. Report security issues privately to the repository owner.
