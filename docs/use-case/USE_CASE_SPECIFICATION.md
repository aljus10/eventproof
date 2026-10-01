# EventProof: System Use Case Specification Document

**Project:** EventProof — Offline-First Attendance and Verifiable E-Certificate Management System  
**Architecture:** Micro-modular Spring Boot 3 + H2/Flyway + Offline IndexedDB + Ed25519 & HMAC Cryptography  
**Specification Standard:** UML 2.5 Architecture Model  
**Diagram Reference:** [`docs/use-case/eventproof_use_case_diagram.png`](eventproof_use_case_diagram.png) • [`eventproof_use_case.puml`](eventproof_use_case.puml) • [`eventproof_use_case.mmd`](eventproof_use_case.mmd) • [`EventProof_Use_Case_Diagram.svg`](EventProof_Use_Case_Diagram.svg)

---

## 1. Executive Summary & Actors

EventProof provides cryptographic attendance tracking, offline-first venue scanning, dynamic student roster administration, and tamper-evident digital e-certificate issuance and verification.

```
+---------------------------------------------------------------------------------------------------------+
|                                        EVENTPROOF SYSTEM BOUNDARY                                       |
|                                                                                                         |
|   [ STUDENT / PARTICIPANT ]                        [ EVENT MANAGER ]                                    |
|     * Present Event QR                               * Manage Events                                    |
|     * Check In to Event                              * Manage Students                                  |
|     * Request Manual Lookup                          * Register Students to Event                       |
|                                                      * Generate Event QR Passes                         |
|   [ CORE ATTENDANCE FLOW ]                           * Set Up Scanner                                   |
|     * Identify Participant                                                                              |
|     * Confirm Attendance                           [ SCANNER STAFF ]                                    |
|     * Record Attendance                              * Scan Student QR                                  |
|                                                      * Find Student Manually                            |
|   [ CERTIFICATE & GOVERNANCE ]                       * Sync Offline Attendance (When connection returns)|
|     * View Certificate Eligibility                   * Monitor Live Attendance                          |
|     * Configure Certificate                                                                             |
|     * Manage Certificate Templates                 [ SYSTEM ADMIN ]                                     |
|     * Check Certificate Eligibility                  * View Certificate Eligibility                     |
|     * Generate Certificate PDF                       * Configure Certificate                            |
|     * Issue Certificate                              * Manage Certificate Templates                     |
|     * Bulk Issue Certificates                        * Issue Certificate                                |
|     * Revoke / Restore Certificate                   * Bulk Issue Certificates                          |
|                                                      * Revoke / Restore Certificate                     |
|   [ PUBLIC VERIFICATION ]                                                                               |
|     * Verify Certificate                                                                                |
|     * Check Certificate Status (VALID / REVOKED / UNKNOWN / INVALID)                                    |
+---------------------------------------------------------------------------------------------------------+
```

### System Actors

| Actor | Role Type | Description |
| :--- | :--- | :--- |
| **👤 Student / Participant** | Primary Beneficiary | Student or seminar attendee. Check-in is initiated either by presenting a signed QR badge or requesting a manual name lookup. Receives verifiable digital certificates. |
| **👤 Event Manager** | Institutional Operator | Authors institutional events, oversees student rosters, links students to events, generates cryptographic event passes, and pairs scanner stations. |
| **👤 Scanner Staff** | Venue Gate Operator | Stationed at venue entrances. Uses smartphone camera or tablet to scan student QR badges, performs manual lookups when needed, logs attendance, and synchronizes transactions offline or online. |
| **👤 System Admin** | Registrar / Governance | Manages certificate templates (WYSIWYG layout designer), audits attendance eligibility, issues signed PDF e-certificates individually or in bulk, and revokes/restores certificates. |
| **👤 Public Verifier** | Independent Auditor | External employer, school registrar, or scholarship board verifying certificate legitimacy via hash token or verification URL. |

---

## 2. Relationships & Dependency Matrix

| Base Use Case | Target Use Case | Relationship | Condition / Multiplicity |
| :--- | :--- | :--- | :--- |
| **Check In to Event** | Present Event QR | `<<extend>>` | `[when student has QR]` |
| **Check In to Event** | Request Manual Lookup | `<<extend>>` | `[when QR is unavailable]` (e.g. dead battery, lost pass) |
| **Check In to Event** | Identify Participant | `<<include>>` | Mandatory resolution of student identity |
| **Check In to Event** | Confirm Attendance | `<<include>>` | Mandatory stage check (Time-In / Departure) |
| **Scan Student QR** | Identify Participant | `<<include>>` | Resolves student ID from decoded QR token |
| **Find Student Manually** | Identify Participant | `<<include>>` | Resolves student ID via search filter on roster |
| **Confirm Attendance** | Record Attendance | `<<include>>` | Writes timestamp to local DB or IndexedDB sync queue |
| **Issue Certificate** | Check Certificate Eligibility | `<<include>>` | Precondition: Must be registered and marked `PRESENT` |
| **Issue Certificate** | Generate Certificate PDF | `<<include>>` | Renders signed PDF with QR and cryptographic seal |
| **Bulk Issue Certificates** | Issue Certificate | `<<include>>` | Iterates across all qualifying attendees |
| **Bulk Issue Certificates** | Check Certificate Eligibility | `<<include>>` | Pre-filters non-eligible candidates before issuance |
| **Verify Certificate** | Check Certificate Status | `<<include>>` | Evaluates signature & database status (`VALID`, `REVOKED`, etc.) |

---

## 3. Detailed Use Case Specifications

### 3.1 Student / Participant & Entrance Check-In

#### **UC-01: Check In to Event**
- **Actor:** 👤 Student / Participant, 👤 Scanner Staff
- **Trigger:** Student arrives at event check-in point.
- **Includes:** `Identify Participant`, `Confirm Attendance`
- **Extends by:** `Present Event QR` [when student has QR], `Request Manual Lookup` [when QR is unavailable]
- **Main Flow:**
  1. Student initiates check-in through presenting QR or requesting manual lookup.
  2. System resolves and executes `Identify Participant`.
  3. System confirms attendee details and triggers `Confirm Attendance`.
  4. System updates attendance state to `PRESENT`.
- **Postconditions:** Student attendance recorded with timestamp.

#### **UC-02: Present Event QR**
- **Actor:** 👤 Student / Participant
- **Description:** Student presents digital QR badge on phone screen or physical printed badge.
- **Condition:** Extends `Check In to Event` when student has access to their generated pass.

#### **UC-03: Request Manual Lookup**
- **Actor:** 👤 Student / Participant, 👤 Scanner Staff
- **Description:** If student does not have phone, battery died, or paper pass is misplaced, student requests staff to search roster by student number or surname.
- **Condition:** Extends `Check In to Event` when QR pass is unavailable.

#### **UC-04: Identify Participant**
- **Actor:** 👤 Scanner Staff
- **Trigger:** QR scan decoded or manual search entered.
- **Main Flow:**
  1. System checks decoded token (`EP1.<credential>.<signature>`) or student search query.
  2. Validates registration against selected active event.
  3. Displays student full name, student ID, and previous check-in status on scanner interface.
- **Alternate Flow:** If credential signature is forged or student is not enrolled in event, scanner alerts `Unregistered / Invalid Credential`.

#### **UC-05: Confirm Attendance**
- **Actor:** 👤 Scanner Staff
- **Includes:** `Record Attendance`
- **Main Flow:**
  1. Staff verifies student match on device screen.
  2. Staff taps `Confirm Time-In` (or `Confirm Logout` for dual-stage events).
  3. System triggers `Record Attendance`.

#### **UC-06: Record Attendance**
- **Main Flow:**
  1. System generates a unique client transaction ID (`TX-...`).
  2. If online: writes directly to server database via REST API.
  3. If offline: persists into browser `IndexedDB` queue preserving original millisecond timestamp.
- **Postconditions:** Student marked present; duplicate check-ins within event are idempotently handled.

---

### 3.2 Event Manager Subsystem

#### **UC-07: Manage Events**
- **Actor:** 👤 Event Manager
- **Description:** Create, update, list, and view institutional events (name, date, time, venue, description).

#### **UC-08: Manage Students**
- **Actor:** 👤 Event Manager
- **Description:** View institutional student database, update student records, or import cohorts.

#### **UC-09: Register Students to Event**
- **Actor:** 👤 Event Manager
- **Description:** Enroll students into selected event rosters, assigning unique credential tokens.

#### **UC-10: Generate Event QR Passes**
- **Actor:** 👤 Event Manager
- **Description:** Creates cryptographic Ed25519-signed QR code passes for all enrolled students. Allows printing badges or sharing credential links.

#### **UC-11: Set Up Scanner**
- **Actor:** 👤 Event Manager
- **Description:** Provisions scanner station tokens (`PAIR-...`), pairs entrance smartphones via QR pairing handshake, and monitors connection status.

---

### 3.3 Scanner Staff Subsystem

#### **UC-12: Scan Student QR**
- **Actor:** 👤 Scanner Staff
- **Includes:** `Identify Participant`
- **Description:** Uses phone camera with integrated `jsQR` scanner to scan student badges in real time.

#### **UC-13: Find Student Manually**
- **Actor:** 👤 Scanner Staff
- **Includes:** `Identify Participant`
- **Description:** Searchable live roster input field for manual check-ins when QR cannot be scanned.

#### **UC-14: Sync Offline Attendance**
- **Actor:** 👤 Scanner Staff
- **Condition:** *When connection returns*
- **Main Flow:**
  1. Scanner monitors browser `navigator.onLine` and ping heartbeats.
  2. When connectivity is restored, scanner sends batch of cached `IndexedDB` records.
  3. Server ingests records idempotently without altering original `capturedAt` timestamps.

#### **UC-15: Monitor Live Attendance**
- **Actor:** 👤 Scanner Staff (and 👤 Event Manager)
- **Description:** Real-time head count, percentage of attendees checked in, and live SSE activity log.

---

### 3.4 System Administrator Subsystem

#### **UC-16: View Certificate Eligibility**
- **Actor:** 👤 System Admin
- **Description:** Audits attendees for a chosen event. Distinguishes `Eligible` (`Registered + Present`) from `Absent` participants.

#### **UC-17: Configure Certificate**
- **Actor:** 👤 System Admin
- **Description:** Sets event certificate title, signatories, issuing organization, and issue dates.

#### **UC-18: Manage Certificate Templates**
- **Actor:** 👤 System Admin
- **Description:** Interactive WYSIWYG coordinate layout tool for positioning student name, body text, date, signatures, and QR codes over custom background graphics.

#### **UC-19: Check Certificate Eligibility**
- **Rule:** *Eligible only if registered and marked PRESENT.*
- **Included by:** `Issue Certificate`, `Bulk Issue Certificates`
- **Outcome:** Rejects certificate issuance for absent or non-registered individuals.

#### **UC-20: Generate Certificate PDF**
- **Included by:** `Issue Certificate`
- **Description:** Vector PDF generator embedding cryptographic hash, verification QR code, and custom styling.

#### **UC-21: Issue Certificate**
- **Actor:** 👤 System Admin
- **Includes:** `Check Certificate Eligibility`, `Generate Certificate PDF`
- **Description:** Generates individual signed certificate record and downloadable PDF.

#### **UC-22: Bulk Issue Certificates**
- **Actor:** 👤 System Admin
- **Includes:** `Issue Certificate`, `Check Certificate Eligibility`
- **Description:** Processes all eligible attendees in a single batch, packaging signed PDFs into a downloadable ZIP archive.

#### **UC-23: Revoke / Restore Certificate**
- **Actor:** 👤 System Admin
- **Description:** Marks a previously issued certificate as `REVOKED` with audit reason, or restores an erroneously revoked certificate back to `VALID`.

---

### 3.5 Public Verification Subsystem

#### **UC-24: Verify Certificate**
- **Actor:** 👤 Public Verifier
- **Includes:** `Check Certificate Status`
- **Trigger:** Verifier navigates to `/verify.html` or scans verification QR code on PDF.

#### **UC-25: Check Certificate Status**
- **Outputs:**
  - `VALID`: Cryptographic signature verified and certificate active in institutional registry.
  - `REVOKED`: Certificate was invalidated by institutional authority with audit timestamp.
  - `UNKNOWN / INVALID`: Token not found or digital signature tampered.
