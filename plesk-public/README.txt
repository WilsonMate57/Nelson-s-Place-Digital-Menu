Intentionally empty Plesk "Document root" for the Node.js app.
Keeping it empty makes every request go through the Node app, so the
security headers (CSP etc.) are applied to all pages. Do not put files here.
See docs/PLESK.md.
