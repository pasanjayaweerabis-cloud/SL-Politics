---
name: SL Politics Security
description: Security guidance for the SL Politics project.
---

# SL Politics Security

This skill provides security guidance for the SL Politics project.


# Security Policy — Javora / SL Politics

## Purpose

This document defines the security model, secure-development rules, deployment requirements, and incident-response expectations for the Javora / SL Politics web application.

The primary security objective is:

> **Public users may read intentionally public political-record data, but they must not be able to modify, delete, insert, corrupt, or gain unauthorized access to the application's trusted data, database, server, deployment environment, or administrative capabilities.**

The application must be designed so that compromising one layer does not automatically compromise the next layer.

---

## 1. Security Principles

### 1.1 Never trust the frontend

The browser is fully attacker-controlled. An attacker can modify JavaScript, HTML, browser storage, cookies available to JavaScript, request bodies, query parameters, HTTP methods, headers, and API requests.

Frontend validation and hidden UI controls are **not security controls**.

All security-sensitive decisions must be enforced server-side.

### 1.2 Public data is intentionally public

If data is displayed to an unauthenticated visitor, assume the visitor can inspect, download, scrape, reproduce, and query it directly.

Do not attempt to protect intentionally public data through frontend obscurity.

Protect instead:

- data integrity
- internal metadata
- credentials
- databases
- backups
- administrative functions
- infrastructure

### 1.3 Public access must never imply write access

The public application is fundamentally read-only.

Anonymous users must not be able to:

- INSERT records
- UPDATE records
- DELETE records
- alter database schema
- alter source/evidence records
- modify political affiliations
- modify positions
- modify education
- modify employment
- modify research claims
- modify provenance
- create administrative users

A hidden endpoint is not protection.

---

## 2. Trust Boundaries

The intended production architecture is:

```text
                         INTERNET
                            |
                            v
                    CDN / WAF / DDoS
                            |
                            v
                         NGINX
                     TLS + Headers
                            |
              +-------------+-------------+
              |                           |
              v                           v
        React Frontend              Public API
                                          |
                                     GET / SELECT
                                          |
                                          v
                                  PRIVATE DATABASE
                                          |
                                          X
                                  Internet access
```

Administrative functionality, if introduced later, must be separated:

```text
                    ADMIN USER
                        |
                Strong Authentication
                        |
                Phishing-resistant MFA
                        |
                 Server-side RBAC
                        |
                  Admin API
                        |
                 Write-capable DB role
                        |
                        v
                  PRIVATE DATABASE
```

The public API must not receive write-capable database credentials.

---

## 3. Database Protection

### 3.1 Database must never be public

PostgreSQL/SQLite must not be directly reachable from the public Internet.

Do not expose:

- database ports
- database files
- SQL dumps
- database backups
- database administration interfaces

Database networking must be restricted to the application/private network.

### 3.2 Least privilege

Use separate database identities where practical.

Recommended model:

```text
public_api_role
    SELECT only

admin_write_role
    SELECT
    INSERT
    UPDATE
    DELETE
```

The public API should never receive a database credential capable of destructive operations.

### 3.3 Parameterized SQL

All SQL must use parameterized queries / prepared statements.

Never construct SQL by concatenating attacker-controlled input.

### 3.4 Database integrity

Use:

- primary keys
- foreign keys
- uniqueness constraints
- appropriate CHECK constraints
- transactions
- integrity validation

Important public records should not be silently overwritten when historical traceability is required.

---

## 4. API Security

### 4.1 Public API

The public API is read-only.

Allowed methods should be explicitly defined.

Expected public methods:

```text
GET
OPTIONS
HEAD (where appropriate)
```

Reject unsupported methods with:

```text
405 Method Not Allowed
```

Do not rely on the React UI to prevent write requests.

### 4.2 Every endpoint must be reviewed

For every endpoint document:

- purpose
- allowed methods
- authentication requirement
- authorization requirement
- input schema
- maximum input size
- output schema
- rate limit
- database operations
- external network access
- logging behavior

### 4.3 Direct API testing

Every endpoint must be tested directly without the frontend.

At minimum test:

```text
GET
POST
PUT
PATCH
DELETE
OPTIONS
HEAD
```

Changing the HTTP method must never bypass authorization.

Also test method-override and proxy-related headers such as:

```text
X-HTTP-Method-Override
X-Method-Override
X-Original-URL
X-Rewrite-URL
```

Do not use proxy headers as a substitute for real authorization.

---

## 5. Authorization

If administrative functionality is added:

### 5.1 Server-side authorization is mandatory

Never trust:

- frontend role flags
- hidden routes
- localStorage roles
- query parameters
- client-side `isAdmin`
- special URLs
- IP addresses alone

The server must independently determine:

```text
Who is this?
What role do they have?
Are they allowed to perform this exact operation?
```

### 5.2 Deny by default

Unknown or missing permissions must result in denial.

New endpoints must not accidentally inherit public access.

### 5.3 Prevent IDOR/BOLA

Never assume that knowing an object ID grants permission.

Test:

```text
User A -> object A
User A -> object B
User A -> admin object
Anonymous -> private object
```

Every object-level authorization decision must be performed server-side.

---

## 6. Frontend Security

### 6.1 XSS

Avoid:

- `dangerouslySetInnerHTML`
- `innerHTML`
- unsafe HTML rendering
- unsafe dynamic script injection
- `eval`
- `new Function`

All user-controlled or externally sourced text must be safely rendered.

### 6.2 URLs

External URLs must use a strict allowlist/validation policy.

Reject dangerous schemes including:

```text
javascript:
data:
file:
```

Use the project's `safeExternalHref()` or equivalent centralized guard consistently.

### 6.3 Content Security Policy

Production must use a Content Security Policy appropriate to the actual application.

Do not weaken CSP with `unsafe-eval` or broad `unsafe-inline` unless there is a documented, reviewed requirement.

CSP is defense-in-depth, not a replacement for safe output handling.

---

## 7. Bundled Data and Information Exposure

The production frontend must contain only information intentionally public.

Do not ship:

```text
.env
database credentials
database files
SQL dumps
backups
private research metadata
internal source snapshots
internal operational secrets
```

Bundled public political records are inherently downloadable and should not be treated as confidential.

Development/demo fallback datasets must not silently become the production source of truth.

Production should prefer:

```text
React -> API -> Database
```

while development/demo environments may use static fixtures where appropriate.

---

## 8. Source and Evidence Security

Because the application publishes political information, data integrity is a security requirement.

Important claims should have traceable provenance:

```text
Claim
  |
  +-- Source
  +-- Exact evidence
  +-- URL/document
  +-- Date
  +-- Verification state
```

AI-generated research may assist discovery, but should not be treated as the ultimate authority for factual claims about real people.

Whenever practical, verify significant claims against primary or otherwise credible sources before publication.

Do not silently turn uncertain information into definitive factual statements.

---

## 9. Identity Integrity

The system must minimize the possibility of attributing information to the wrong person.

Before publishing or merging records, verify identity using appropriate evidence.

Pay particular attention to:

- same-name individuals
- transliteration differences
- initials
- historical office holders
- duplicate records
- identity merges

Identity-review metadata must be treated as controlled editorial data, not casually exposed in the public bundle.

---

## 10. Correction and Reporting System

The correction mechanism must be designed as a moderation workflow.

Recommended flow:

```text
Public user
    |
    v
Correction submission
    |
    v
Validation
    |
    v
Moderation queue
    |
    v
Human review
    |
    v
Evidence verification
    |
    v
Approved change
    |
    v
Database transaction
    |
    v
Immutable audit record
```

A public correction submission must never directly modify canonical records.

All validation must be repeated server-side.

---

## 11. SSRF Protection

If the server ever fetches a user-supplied URL, treat the URL as hostile.

Protect against:

- localhost
- 127.0.0.1
- IPv6 loopback
- private RFC1918 networks
- link-local addresses
- cloud metadata services
- internal hostnames
- DNS rebinding
- redirect-based SSRF
- alternate IP representations

Prefer explicit destination allowlists where the business requirement permits them.

Do not fetch arbitrary URLs from the server merely because the URL passes superficial syntax validation.

---

## 12. File Security

Avoid public file uploads unless genuinely required.

If uploads are introduced:

- allowlist file types
- validate content, not only extensions
- enforce size limits
- generate server-side filenames
- store outside the webroot
- prevent path traversal
- prevent executable content
- scan files where appropriate
- apply authorization
- apply rate limiting
- protect against malicious archives

Never use user-controlled filenames as filesystem paths.

---

## 13. Path Traversal

Never allow attacker-controlled strings to directly construct filesystem paths.

Test:

```text
../../../../etc/passwd
..%2F..%2F..%2F
%2e%2e%2f
absolute paths
Windows-style paths
encoded traversal
double encoding
null-byte tricks
```

Database files, backups, logs, environment files, and Git metadata must never be publicly downloadable.

---

## 14. HTTP Security

Production should use appropriate:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
X-Frame-Options / frame-ancestors
```

Use secure cache policies where sensitive content exists.

CORS must be restrictive.

Do not use:

```text
Access-Control-Allow-Origin: *
```

for authenticated/private functionality.

Do not combine wildcard origins with credentials.

---

## 15. NGINX Security

The reverse proxy must:

- force HTTPS in production
- enable HSTS after HTTPS is confirmed
- disable unnecessary server version disclosure
- block dotfiles
- block database files
- block backups
- block SQL dumps
- block `.env`
- block `.git`
- block logs
- prevent directory listing unless explicitly required
- enforce sensible request-size limits
- enforce edge rate limits
- use secure proxy headers
- apply sane connection and upstream timeouts

Never expose these through the public web server:

```text
.data/
.git/
.env*
*.db
*.sqlite
*.sqlite3
*.bak
*.backup
*.dump
*.sql
*.log
```

---

## 16. Docker Security

Production containers should:

- run as non-root
- use minimal trusted base images
- pin important image versions
- expose only required ports
- drop unnecessary Linux capabilities
- avoid privileged mode
- avoid mounting sensitive host paths
- use read-only filesystems where practical
- separate networks
- apply resource limits
- avoid placing secrets in images

The database should be on a private network.

---

## 17. Rate Limiting and Resource Protection

Rate limiting is defense-in-depth, not authorization.

Protect:

- search
- API endpoints
- correction submissions
- authentication
- administrative operations

Limit:

- query length
- page size
- parameter count
- request body size
- response size
- expensive query complexity
- external request time
- concurrent connections

If the application is horizontally scaled, do not rely solely on process-local rate limiting.

Use an edge/shared mechanism such as:

- WAF
- nginx
- Redis
- API gateway
- CDN provider

where appropriate.

---

## 18. Denial-of-Service Resistance

Identify operations that can consume disproportionate resources.

Prevent:

- unbounded pagination
- huge searches
- expensive regular expressions
- recursive processing
- oversized JSON
- repeated external fetches
- excessive database scans

Use:

- indexes
- bounded queries
- query timeouts
- request limits
- connection limits
- rate limits
- pagination

---

## 19. Secrets Management

Never commit:

- passwords
- API keys
- access tokens
- JWT secrets
- private keys
- cloud credentials
- database credentials
- deployment credentials

Secrets must come from an appropriate secret/environment mechanism.

If a real secret is ever committed:

1. Assume compromise.
2. Rotate/revoke it.
3. Remove it from source/history as appropriate.
4. Audit where it was used.
5. Replace it with secure secret management.

Never print complete secrets in logs or security reports.

---

## 20. CI/CD and Supply-Chain Security

Treat the development and deployment pipeline as part of the security perimeter.

Maintain:

- lockfiles
- dependency scanning
- `npm audit` or equivalent
- automated security updates
- secret scanning
- SAST
- dependency review
- SBOM generation where practical
- branch protection
- protected deployment environments
- least-privilege CI credentials
- short-lived credentials where practical

CI must not receive unnecessary database credentials.

Separate:

```text
build credentials
deployment credentials
runtime credentials
database credentials
```

Do not install unreviewed packages merely to solve a minor development problem.

Review suspicious dependency changes carefully.

---

## 21. Dependency Security

Before production releases:

```bash
npm audit
npm test
npm run lint
npm run typecheck
npm run build
```

Review dependency updates for:

- known vulnerabilities
- malicious packages
- maintainer/account compromise
- unexpected install scripts
- unnecessary packages
- abandoned packages

Do not blindly upgrade dependencies without testing compatibility.

---

## 22. Logging and Monitoring

Security-relevant events should be logged safely.

Potential events:

- failed authentication
- authorization failures
- suspicious requests
- rate-limit violations
- administrative changes
- data modifications
- permission changes
- unusual traffic
- unexpected server errors

Never log:

- passwords
- session tokens
- authorization headers
- API secrets
- private credentials

Use log rotation and storage controls to prevent disk exhaustion.

Where practical, alert on:

- mass changes
- mass deletion attempts
- creation of administrative accounts
- privilege changes
- repeated failed admin logins
- abnormal API traffic
- backup deletion
- unexpected schema changes

---

## 23. Data Modification Audit Trail

Any future privileged change to important records must be attributable.

Record:

```text
who
what
when
before
after
reason
source/evidence
request context where appropriate
```

Example:

```text
Person: 123
Field: political_affiliation
Old value: X
New value: Y
Changed by: admin-account-7
Reason: verified correction
Evidence: official source
Timestamp: UTC
```

Do not silently overwrite important historical changes.

---

## 24. Backups and Recovery

Backups are security-sensitive assets.

Backups must:

- never be public
- never be in the frontend
- never be inside `dist`
- never be served by nginx
- have restricted filesystem permissions
- be encrypted where appropriate
- have controlled retention
- be tested for restoration
- be protected from unauthorized deletion

Keep recovery capability separate from the primary application where practical.

A compromised application must not automatically be able to destroy every backup.

---

## 25. Error Handling

Production responses must not expose:

- stack traces
- SQL statements
- filesystem paths
- environment variables
- database connection strings
- internal hostnames
- secrets
- source code

Return generic errors to clients.

Keep detailed diagnostics server-side.

---

## 26. Security Testing Requirements

Security testing must occur at the HTTP/API level, not only through the UI.

At minimum test:

### Injection

```text
'
"
' OR 1=1--
'; DROP TABLE person;--
```

### XSS

```text
<script>alert(1)</script>
javascript:alert(1)
```

### Path traversal

```text
../../../../etc/passwd
..%2F..%2F
```

### SSRF

```text
http://127.0.0.1
http://localhost
http://169.254.169.254
```

### HTTP methods

```text
GET
POST
PUT
PATCH
DELETE
OPTIONS
HEAD
```

### Header/method override

```text
X-HTTP-Method-Override
X-Method-Override
X-Original-URL
X-Rewrite-URL
```

### Oversized input

Test:

- very long query strings
- very large bodies
- excessive parameters
- extreme pagination values

### Authorization

Test:

```text
anonymous -> public
anonymous -> private
user A -> user A
user A -> user B
normal user -> admin
admin -> unauthorized object
```

---

## 27. Production Artifact Verification

After every production build, inspect `dist/`.

Verify that it contains no:

- secrets
- database credentials
- `.env`
- `.git`
- `.data`
- database files
- SQL dumps
- private research metadata
- development credentials
- unintended source maps
- internal URLs

Search generated JavaScript for sensitive strings.

The build must be treated as a security boundary.

---

## 28. Security Regression Rules

Every security fix must include a regression test when practical.

Examples:

- unsupported methods remain `405`
- SQL injection remains ineffective
- CSP remains present
- database files remain inaccessible
- secrets remain absent from production assets
- authorization remains server-side
- path traversal remains blocked
- correction submissions cannot directly modify canonical data

Security tests must run in CI before production deployment.

---

## 29. Secure Development Workflow

For every new feature:

### Step 1 — Threat model

Ask:

```text
What can an attacker control?
What can they reach?
What can they change?
What can they cause the server to do?
```

### Step 2 — Define trust boundary

Identify:

```text
browser
API
database
filesystem
external services
admin
CI/CD
```

### Step 3 — Minimize privilege

Give each component only the permissions it needs.

### Step 4 — Validate server-side

Never rely on frontend validation.

### Step 5 — Test adversarially

Attempt to bypass the intended control.

### Step 6 — Add regression tests

Prevent the vulnerability from returning.

---

## 30. Security Standards

Use the following as the project's security baseline:

- OWASP ASVS 5.x for application security requirements
- OWASP Web Security Testing Guide for penetration/security testing
- OWASP Top 10 for risk awareness
- OWASP API Security guidance for API-specific threats
- NIST Secure Software Development Framework (SSDF)
- CISA Secure by Design / Secure by Default principles

For this application, target:

> **OWASP ASVS Level 2 as the general baseline, with stronger controls around privileged administration, database access, data integrity, and deployment.**

---

## 31. Incident Response

If unauthorized access or data modification is suspected:

1. Do not immediately destroy logs or evidence.
2. Preserve relevant logs.
3. Restrict compromised credentials.
4. Rotate affected secrets.
5. Disable compromised administrative accounts.
6. Isolate affected services where necessary.
7. Determine whether database records changed.
8. Compare records against trusted sources/backups.
9. Restore from a known-good backup if required.
10. Identify the initial attack vector.
11. Patch the vulnerability.
12. Verify the patch independently.
13. Review whether backups were affected.
14. Document the incident.
15. Follow applicable legal/notification requirements.

Do not claim an incident is resolved until the attack path has been identified or reasonably contained and the environment has been revalidated.

---

## 32. Responsible Disclosure

Security researchers should be encouraged to report vulnerabilities responsibly.

Provide a security contact in the repository/project documentation.

Reports should include:

- affected endpoint/file
- reproduction steps
- security impact
- evidence
- suggested mitigation where available

Do not publicly disclose an exploitable vulnerability before an appropriate remediation window.

---

## 33. Release Security Checklist

Before every production deployment:

- [ ] `npm audit` reviewed
- [ ] tests pass
- [ ] lint passes
- [ ] typecheck passes
- [ ] production build succeeds
- [ ] production build scanned for secrets
- [ ] database files absent from public assets
- [ ] backups absent from public assets
- [ ] `.env` absent from public assets
- [ ] `.git` absent from public assets
- [ ] CSP enabled
- [ ] HTTPS configured
- [ ] HSTS configured appropriately
- [ ] CORS reviewed
- [ ] public API remains read-only
- [ ] unsupported HTTP methods return `405`
- [ ] SQL queries remain parameterized
- [ ] rate limiting enabled
- [ ] request-size limits enabled
- [ ] database is not Internet-facing
- [ ] production containers run non-root
- [ ] logs do not contain secrets
- [ ] deployment credentials are protected
- [ ] backups are protected
- [ ] security regression tests pass

---

## 34. Non-Negotiable Security Invariants

The following must remain true unless this policy is deliberately revised and the security architecture is re-reviewed.

### Invariant 1

**An anonymous Internet user cannot modify canonical data.**

### Invariant 2

**An anonymous Internet user cannot delete canonical data.**

### Invariant 3

**An anonymous Internet user cannot insert arbitrary canonical records.**

### Invariant 4

**An anonymous Internet user cannot obtain database credentials.**

### Invariant 5

**An anonymous Internet user cannot directly reach the database.**

### Invariant 6

**Frontend controls are never treated as authorization.**

### Invariant 7

**Public API database privileges must be limited to the minimum required, ideally read-only.**

### Invariant 8

**Administrative write operations require explicit server-side authentication and authorization.**

### Invariant 9

**Important administrative data changes are attributable and auditable.**

### Invariant 10

**Production builds must not contain secrets or private backend assets.**

### Invariant 11

**A compromise of the frontend must not imply database write access.**

### Invariant 12

**A compromise of the public API must not imply unrestricted database write/delete access.**

### Invariant 13

**A compromised application must not automatically expose all backups.**

### Invariant 14

**Every security-sensitive feature must have adversarial tests and regression coverage.**

---

## 35. Final Security Philosophy

The project must follow this principle:

> **Assume the attacker knows the complete source code. Assume they control their browser. Assume they can call every public API directly. Assume they can inspect every public asset. Security must still hold.**

The desired outcome is:

```text
Attacker
   |
   +--> Frontend
   |      |
   |      +--> Public data       YES
   |      +--> Secrets           NO
   |      +--> DB credentials    NO
   |
   +--> Public API
   |      |
   |      +--> Read public data  YES
   |      +--> Write data        NO
   |      +--> Delete data       NO
   |      +--> Arbitrary SQL     NO
   |      +--> Private data      NO
   |
   +--> Database
   |      |
   |      +--> Direct Internet access  NO
   |      +--> Public DB credentials   NO
   |
   +--> Administration
          |
          +--> Without strong auth    NO
          +--> Without authorization  NO
          +--> Without audit trail    NO
```

Security is not achieved by making the application impossible to inspect.

Security is achieved by ensuring that **inspection, scraping, frontend manipulation, API probing, and hostile input do not cross the trust boundaries that protect data integrity and privileged operations.**

This policy should be reviewed whenever the application adds:

- authentication
- administration
- database write operations
- file uploads
- external URL fetching
- user accounts
- payments
- new third-party integrations
- new deployment infrastructure
- major dependencies
- new CI/CD capabilities
