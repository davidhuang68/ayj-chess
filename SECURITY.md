# AYJ Chess security

Public visitors can read explicitly published session summaries, published pairings/results, and standings. Account details, private sessions, the full player database, rating history, and admin logs are excluded by an allowlist on the server. Public endpoints do not accept writes or use visitor session cookies.

Club reads and changes require a valid, unexpired session for an active account and a current club membership. Admin permissions are enforced on the server. Version checks prevent simultaneous managers from overwriting one another's work. SQL values use bound parameters; user-entered names render as text. CSV exports neutralize formula-like names.

Passwords use salted bcrypt hashes. Only hashes of random session tokens are stored. Production session cookies use Secure, HttpOnly, SameSite, and the host-only cookie prefix. Logout, password changes/resets, and account disabling revoke the affected sessions. A stale password change cannot overwrite a newer password.

Login throttling uses persistent independent username and trusted-client-IP limits, with rolling 15-minute windows and bounded counters. Old attempt keys expire. Password-change guesses have a separate account limit. Writes require an exact same-origin Origin header and JSON content type, and request streams have byte limits before parsing. The Vercel bridge forwards only approved paths, query parameters, and app cookies to its configured private backend; credentials remain server-side.

## Maintenance and limits

- Use a long, unique password for every account. Do not share the admin login. Disable managers who no longer need access.
- No minimum password length is enforced, by the admin's explicit choice. Short passwords remain guessable despite throttling; the review does not establish that existing passwords are strong.
- Protect the hosting account with its own strong password and multifactor authentication. Application protections cannot protect a compromised hosting account or device.
- Run `npm audit` after dependency changes and periodically apply compatible security updates. A clean audit covers known package advisories at the time checked; it does not establish that the application has no vulnerabilities.
- Keep backups privately. Do not commit environment files, tokens, database copies, or browser session data. The existing backup includes club data rather than authentication secrets.
- This review is an application review and targeted regression testing, not a guarantee against all attacks or an independent penetration test. No scheduled monitoring is configured.

References: [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Vercel trusted request headers](https://vercel.com/docs/headers/request-headers), and [Next.js security advisories](https://github.com/vercel/next.js/security/advisories).
