# Security model

This is a private, single-tutor application without public registration. Teacher credentials are bootstrapped on the server. Student access uses revocable random bearer links; only token hashes are stored in PostgreSQL. Student cookies are HttpOnly and SameSite=Lax; production uses HTTPS and Secure cookies. Link tokens travel in URL fragments and are exchanged through a POST request, keeping them out of normal URL access logs.

All application reads and writes check teacher ownership or the authenticated student. Private file storage is outside the public directory. Downloads require access to the relevant homework and force attachment disposition. Writes verify the Origin header. Nginx limits authentication requests; teacher sign-in also has a process-local attempt limiter. Replacing a student link or changing a teacher password invalidates prior sessions at the next API request.

Secrets, first-login credentials, uploads, test screenshots, backups and environment files must stay out of Git. Backups are private and contain sensitive data. Production runs one application process under systemd, with a separate PostgreSQL container bound to loopback.

Run `npm audit --omit=dev` when updating dependencies. The initial deployment has no high or critical production dependency advisories according to the npm audit performed during setup. This statement is a point-in-time result, not a future guarantee.
