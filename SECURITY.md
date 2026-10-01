# 🛡️ EventProof Security Policy & Data Privacy Protocol

## 1. Overview & Institutional Compliance

EventProof handles academic attendance and cryptographic credential issuance. In academic environments, protecting student **Personally Identifiable Information (PII)** and securing cryptographic private keys are legal obligations (e.g., **Philippine Data Privacy Act of 2012 / RA 10173**).

This document outlines the security architecture and instructions for maintaining confidentiality before and after publishing to GitHub.

---

## 2. Classification of Sensitive Assets

| Asset Category | Description | Storage Policy & Protection |
| :--- | :--- | :--- |
| **Classmate & Student PII** | Real names, university student ID numbers, degree programs. | **NEVER commit to GitHub.** Must remain strictly in git-ignored local storage (`data/real_classmates_roster.sql`, `data/real_classmates_roster.csv`). Git-tracked files must exclusively use synthetic demo names (`Juan A. Dela Cruz`, etc.). |
| **Cryptographic Signing Keys** | Ed25519 private key (`eventproof-ed25519-private.key`). | **NEVER commit to GitHub.** Stored in git-ignored `data/` directory. If compromised, an adversary can forge entrance QR passes and signed PDF certificates. |
| **SSL / TLS Keystores** | PKCS12 / JKS certificates (`*.p12`, `*.jks`) used for HTTPS port 8443 camera streaming. | Production keystores and institutional certificates must remain outside version control. |
| **Database State & Session Tokens** | Local H2 database (`eventproof.mv.db`, `eventproof.lock.db`) containing scan history and pairing tokens. | Ignored via `.gitignore`. Each deployment generates its own local database. |
| **Exported Badges & Certificates** | Generated PDFs, ZIP archives, and QR image dumps (`qr-codes/`, `exports/`, `*.pdf`). | Excluded from version control via `.gitignore`. |

---

## 3. Classmate Privacy Protection Strategy

To ensure classmates' names and student numbers are **never disclosed** on GitHub:

1. **Synthetic Public Seed**:
   - `src/main/resources/db/migration/V4__add_event_fields_and_real_students.sql` and `DemoDataInitializer.java` contain **only non-identifiable demo students** (`Juan A. Dela Cruz`, `Maria B. Santos`, `Carlo C. Garcia`, etc.).
2. **Private Local Roster Preservation**:
   - The actual class roster is saved locally at:
     - `data/real_classmates_roster.sql`
     - `data/real_classmates_roster.csv`
   - These files are completely ignored by `.gitignore` and will never appear in `git status` or GitHub commits.
3. **Restoring Local Classmates Roster (Local Development Only)**:
   - For internal school presentation or defense, you can import `data/real_classmates_roster.sql` into your local H2 database:
     ```bash
     # Local database import (runs only on your machine):
     # Flyway maintains demo data; real names stay local.
     ```

---

## 4. Git History Scrubbing & Clean Upload Guide

> [!WARNING]
> If a commit containing real names or keys was previously pushed or committed locally, simply adding a new commit **does NOT remove the data from git history**. Anyone can inspect past commits!

To ensure git history is completely clean before pushing to GitHub:

### Option A: Amend the Initial Commit (Clean Single-Commit Repository)
If your repository currently has only one initial commit, amend it so the real names are completely wiped from git history:

```bash
git add .
git commit --amend -m "Initial commit: EventProof - Institutional Cryptographic Event & Attendance Verification Platform"
git push origin main --force
```

### Option B: Fresh Clean Push (Guaranteed Zero Leaks)
To guarantee that no historical commit contains classmate names or private keys:

```bash
# 1. Create a clean orphan branch
git checkout --orphan clean-main

# 2. Stage all sanitized files
git add .

# 3. Commit the clean state
git commit -m "EventProof: Institutional Cryptographic Event & Attendance Verification Platform (Sanitized Release)"

# 4. Replace main branch
git branch -D main
git branch -m main

# 5. Push cleanly to GitHub
git push -f origin main
```

---

## 5. Reporting a Vulnerability

If you discover any security vulnerability or inadvertent data disclosure:
1. Do **not** open a public issue on GitHub.
2. Immediately rotate the Ed25519 key pair by deleting `data/eventproof-ed25519-private.key` (a fresh pair will be generated on reboot).
3. Contact the repository administrator privately.
