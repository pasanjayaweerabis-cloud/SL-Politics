# Security Policy

SL Politics (Javora) is a public-record site for Sri Lankan political
figures. Its data is intentionally public; its data **integrity**,
infrastructure and administrative capabilities are not. See
`SECURITY--SL Politics.md` for the full security model this project is held
to, and `docs/security-audit.md` / `docs/security-audit-followup-2026-09-04.md`
for the record of what has been reviewed and fixed so far.

## Reporting a vulnerability

**Contact:** pasanjayaweerabis@gmail.com

Please report security issues privately, by email, rather than through a
public GitHub issue — this repository currently has no other
maintainer-facing channel.

### Scope

In scope:

- the public API (`server/api/*`) and anything that would let an anonymous
  request modify, delete, or insert canonical data, or reach the database
  directly
- the static frontend (`src/*`, the prerender pipeline) — XSS, unsafe URL
  handling, secrets or private data shipped in the production build
- the deployment configuration (`deploy/*`, `.github/workflows/*`) — exposed
  credentials, missing security headers, container/CI misconfiguration
- the correction-reporting workflow, once it is connected to a backend (see
  `docs/corrections-security-design.md`) — today it is a stub that submits
  nothing, per its own page

Out of scope:

- the accuracy of a political record itself (report those through the
  in-app "Report an error" page, not here — that is a data-correction
  question, not a security one)
- denial-of-service testing against the live deployment, if one exists;
  describe the finding instead of demonstrating it against production
- social engineering, physical access, or attacks on GitHub's own
  infrastructure

### What to include

- the affected endpoint, file, or URL
- reproduction steps (the exact request/input is more useful than a
  description)
- the security impact — what an attacker gains
- evidence (a request/response, a screenshot, a short log excerpt) —
  redact anything unrelated to the finding itself
- a suggested mitigation, if you have one

### Response and disclosure

This is a small, personally-maintained project, not a company with an SLA.
In good faith:

- you will get an acknowledgement within **5 business days**
- a genuine, in-scope finding will get a fix or a mitigation plan; you will
  be told which
- please allow **90 days** from acknowledgement before any public
  disclosure, or until a fix ships, whichever is sooner — and please
  coordinate the disclosure date with the contact above rather than
  assuming it

No bug bounty is offered. Reporting in good faith, within this scope, and
without accessing, modifying, or exfiltrating data beyond what is needed to
demonstrate the issue, will not be treated as unauthorized access.
