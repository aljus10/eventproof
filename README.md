# 🏛️ EventProof

> **Institutional Cryptographic Event Management, Attendance Verification & Digital Certification Platform**  
> *An offline-first, tamper-evident academic platform for university seminars, summits, and student activities.*

[![Spring Boot 3.5](https://img.shields.io/badge/Spring%20Boot-3.5-brightgreen.svg)](https://spring.io/projects/spring-boot)
[![Java 17](https://img.shields.io/badge/Java-17%2B-orange.svg)](https://www.oracle.com/java/)
[![License](https://img.shields.io/badge/License-Academic%20Capstone-blue.svg)]()
[![Offline First](https://img.shields.io/badge/Architecture-Offline--First-teal.svg)]()

---

## 📋 Table of Contents

- [Overview & Architecture](#-overview--architecture)
- [Prerequisites](#-prerequisites)
- [Quick Start Guide](#-quick-start-guide)
- [How to Connect Mobile Scanner Phones](#-how-to-connect-mobile-scanner-phones)
- [Demo Accounts & Roles](#-demo-accounts--roles)
- [Key Features & System Flows](#-key-features--system-flows)
  - [1. Event Manager Flow](#1-event-manager-flow)
  - [2. Mobile Scanner Staff Flow](#2-mobile-scanner-staff-flow)
  - [3. System Administrator Flow](#3-system-administrator-flow)
  - [4. Public Verification Portal](#4-public-verification-portal)
- [UML Use Case Architecture](#-uml-use-case-architecture)
- [Testing & Verification](#-testing--verification)
- [Project Directory Structure](#-project-directory-structure)

---

## 🌟 Overview & Architecture

**EventProof** is designed for university campus environments where internet connectivity can be intermittent or unavailable during large events. The host laptop runs an embedded server, while mobile phones on the local Wi-Fi router act as entrance and exit scanner stations.

- **Offline-First Resilience**: Scanners cache attendance transactions in browser `IndexedDB` when offline, automatically syncing in idempotent batches when the connection is restored. Original millisecond capture timestamps (`capturedAt`) are strictly preserved.
- **Dual Attendance Tracking**: Supports **Present Only** (standard arrival check-in) and **Present and Logout** (two-stage arrival & departure duration tracking).
- **Cryptographic Tamper-Proof Credentials**: Attendance passes and digital certificates are secured with Ed25519 signatures and SHA-256 HMAC tokens (`EP1...` and `EP-...`).
- **WYSIWYG Certificate Designer**: System administrators can visually design custom certificate templates with background branding, coordinate positioning, and real-time vector PDF sample previews.
- **Dual Port Support**:
  - `http://<LAN-IP>:8080`: Default lightweight HTTP access.
  - `https://<LAN-IP>:8443`: Built-in SSL context allowing continuous mobile camera streaming without configuring browser flags.

---

## 💻 Prerequisites

Ensure your system has the following installed:

1. **Java Development Kit (JDK) 17** or newer:
   ```bash
   java -version
   ```
2. **Apache Maven 3.9+**:
   ```bash
   mvn -version
   ```
3. **Git**:
   ```bash
   git --version
   ```
4. **Modern Web Browser** (Chrome, Edge, Firefox, or Safari).

> 💡 *Note: No public internet connection is required during normal EventProof runtime! All CSS, JavaScript, and fonts are bundled locally with zero external CDN dependencies.*

---

## 🚀 Quick Start Guide

### 1. Clone the Repository
```bash
git clone https://github.com/aljus10/eventproof.git
cd eventproof
```

### 2. Build the Application
```bash
mvn clean package -DskipTests
```

### 3. Run the Server
```bash
java -jar target/eventproof-clean-1.0.0.jar
```
*(Alternatively, you can run directly with Maven: `mvn spring-boot:run`)*

### 4. Access the Platform
Open your browser and navigate to:
👉 **`http://localhost:8080`**

---

## 📱 How to Connect Mobile Scanner Phones

To use mobile smartphones as scanner stations during an event:

### Step 1: Connect to the Same Local Network
Connect the host laptop and the mobile smartphones to the **same Wi-Fi router** or local mobile hotspot (internet connection is NOT required).

### Step 2: Find Your Laptop's Local IP Address
- **On Windows**: Open Command Prompt / PowerShell and run:
  ```powershell
  ipconfig
  ```
  Look for **IPv4 Address** (e.g., `192.168.1.15`).
- **On Mac/Linux**: Run `ifconfig` or `ip a` (e.g., `192.168.1.15`).

### Step 3: Open Scanner on the Phone
Open the phone browser (Chrome, Safari, etc.) and choose either connection mode:

| Connection Mode | URL on Phone | Camera Behavior |
| :--- | :--- | :--- |
| **Option A: HTTP (Recommended)** | `http://<laptop-ip>:8080/scanner.html` | Tap **"SNAP QR PHOTO"** — opens phone camera immediately. **Zero configuration and NO Chrome flags needed!** |
| **Option B: HTTPS (Live Stream)** | `https://<laptop-ip>:8443/scanner.html` | Tap "Advanced → Proceed" on the initial dev certificate warning. Continuous live video camera stream runs natively. |

---

## 🔑 Demo Accounts & Roles

The system comes pre-seeded with accounts and 38 real BSCS Section student profiles for demonstration:

| Role | Username | Password | Default Redirect | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Event Manager** | `eventmanager` | `demo123` | `/manager.html` | Event authoring, roster selection, live attendance monitoring, and scanner provisioning. |
| **Scanner Staff** | `scanner` | `demo123` | `/scanner.html` | Fast QR attendance verification (Time-In & Time-Out) with offline queueing. |
| **System Admin** | `sysadmin` | `demo123` | `/admin.html` | Certificate template designer, attendance eligibility audit, and bulk ZIP issuance. |
| **Public Verifier** | *No login needed* | *Anonymous* | `/verify.html` | Public portal to verify cryptographic certificates. |

---

## 🛠️ Key Features & System Flows

### 1. Event Manager Flow
1. Sign in as `eventmanager` / `demo123` at `/index.html`.
2. **Create Institutional Event**:
   - **Step 1 (Details)**: Title, Organizer, Date, Start/End Time, Venue, and Description.
   - **Step 2 (Participants & Scope)**: 1-click enroll **All Students**, filter **By Department** (e.g. BSCS), or manually check specific students.
   - **Step 3 (Attendance & Stations)**: Choose **Present Only** (single arrival check-in) or **Present and Logout** (two-stage arrival & departure), and name the default scanner.
   - **Step 4 (Review & Publish)**: Summary card before publishing.
3. **Live Attendance Monitoring**: Watch check-ins stream in real-time via Server-Sent Events (SSE).
4. **Live Demo Flexibility**:
   - **Log Out**: Manually log out an attendee in dual-stage mode.
   - **Unpresent (Undo Check-In)**: Revert an attendee back to absent state, instantly resetting eligibility and allowing smooth repeat demonstrations during presentations.
5. **Pairing Scanner Stations**: Open the **Scanners** tab, click **"Show Pairing QR"**, and click **"Copy Code"** to copy the pure token with 1 click.

### 2. Mobile Scanner Staff Flow
1. Open `/scanner.html` on the phone.
2. Enter the Pairing Code (or scan the pairing QR from the manager screen).
3. Tap **"SCAN STUDENT QR"** or **"SNAP QR PHOTO"** to scan a student's badge.
4. The system decodes the `EP1...` cryptographic token and displays the student's name, ID number, and status without auto-submitting.
5. Tap **CONFIRM TIME-IN** on arrival, and **CONFIRM LOGOUT** on departure (for dual-stage events).
6. If connection drops, transactions queue locally in IndexedDB and synchronize automatically when reconnected.

### 3. System Administrator Flow
1. Sign in as `sysadmin` / `demo123` at `/admin.html`.
2. **Certificate Templates**: Use the WYSIWYG coordinate layout designer to adjust institution seals, recipient names, event dates, signatures, and QR codes. Upload custom background assets and click **"Preview Sample PDF"**.
3. **Attendance Eligibility Audit**: Select an event to inspect attendee statuses (only `Registered + Present` students qualify as *Eligible*).
4. **Bulk Issuance**: Click **"Generate All Eligible Certificates"** and download a compressed ZIP archive containing all digitally signed vector PDFs.
5. **Revocation / Unrevocation**: Revoke invalid certificates with an audit reason, or restore previously revoked certificates back to valid status.

### 4. Public Verification Portal
1. Open `/verify.html` or scan the QR code located at the bottom of any issued certificate PDF.
2. The verification engine checks:
   - Digital cryptographic HMAC SHA-256 signature against the institutional key.
   - Database issuance registry.
   - Active status (`VALID`, `REVOKED`, or `INVALID / TAMPERED`).

---

## 📐 UML Use Case Architecture

The complete system architecture and UML 2.5 Use Case model are available in the [`docs/use-case/`](docs/use-case/) directory:

- 🖼️ **[Actual Use Case Diagram (PNG)](docs/use-case/eventproof_use_case_diagram.png)**: The official high-resolution system diagram detailing all actors, extensions, and inclusions.
- 📊 **[Interactive Use Case Viewer](docs/use-case/use_case_viewer.html)**: Standalone browser viewer with dual-mode display (Actual Image vs. Vector SVG), interactive pan/zoom, and 1-click PNG/SVG exports.
- 🖼️ **[Vector SVG Diagram](docs/use-case/EventProof_Use_Case_Diagram.svg)**: High-resolution scalable vector diagram.
- 📝 **[Use Case Specifications](docs/use-case/USE_CASE_SPECIFICATION.md)**: Comprehensive UML 2.5 tabular documentation covering all actors, flows, rules, and conditions.
- 📐 **[PlantUML Source](docs/use-case/eventproof_use_case.puml)** & **[Mermaid Source](docs/use-case/eventproof_use_case.mmd)**.

---

## 🛡️ Security, Privacy & GitHub Upload Protection

To comply with data privacy principles (e.g., Philippine Data Privacy Act of 2012 / RA 10173) and protect cryptographic infrastructure:

### 1. Student & Classmate PII Protection
- **Zero Real PII in Git**: Public git-tracked seeds (`V4__add_event_fields_and_real_students.sql`, `DemoDataInitializer.java`) use **100% synthetic/anonymized demo identities** (`Juan A. Dela Cruz`, `Maria B. Santos`, etc.).
- **Private Local Roster**: The actual real student roster is isolated in git-ignored files:
  - `data/real_classmates_roster.sql`
  - `data/real_classmates_roster.csv`
  These files reside only on the local machine and are strictly ignored by `.gitignore`.

### 2. Cryptographic Signing Keys & Passwords
- **Ed25519 Private Keys**: Stored in the git-ignored `data/` directory (`eventproof-ed25519-private.key`). Never commit private keys to GitHub; anyone with access to the private key can forge QR passes and certificates.
- **Dynamic QR Code Tokens**: QR tokens are generated dynamically in memory using ephemeral or server-side signed tokens (`EP1...`).
- **Keystores & Databases**: Local database files (`*.mv.db`, `*.lock.db`) and custom SSL keystores are blocked by `.gitignore`.

### 3. Gitignore Hardening
The project `.gitignore` explicitly blocks:
- Cryptographic private keys and certificates (`*.key`, `*.pem`, `*.pkcs8`, `*.jks`, `*.keystore`)
- Local databases (`*.mv.db`, `*.lock.db`, `data/*`)
- Generated exports, certificates, and QR images (`*.pdf`, `*.zip`, `qr-codes/`, `exports/`)
- Student rosters and sensitive spreadsheets (`*.csv`, `*.xlsx`, `*roster*`, `*classmates*`)
- Secrets and environment overrides (`.env`, `*.secret`, `credentials.json`)

---

## 🧪 Testing & Verification

Run the full integration test suite covering event creation, offline sync, dual-stage attendance, unpresent, scanner removal, certificate generation, revocation, and template rendering:

```bash
mvn test
```

All **15 automated tests** run against an in-memory test database and should pass with **0 failures and 0 errors**.

---

## 📁 Project Directory Structure

```text
eventproof/
├── src/
│   ├── main/
│   │   ├── java/org/eventproof/
│   │   │   ├── auth/            # User authentication & role management
│   │   │   ├── student/         # Student roster entities & repositories
│   │   │   ├── event/           # Event models, manager services & controller
│   │   │   ├── scanner/         # Scanner pairing, resolution & sync logic
│   │   │   ├── attendance/      # Attendance entities, SSE & unpresent service
│   │   │   ├── certificate/     # PDF rendering, WYSIWYG templates & revocation
│   │   │   └── config/          # Spring Security & dual HTTP/HTTPS connector
│   │   └── resources/
│   │       ├── application.yml  # Application properties
│   │       ├── db/migration/    # Flyway database schema migrations (V1-V5)
│   │       ├── keystore.p12     # Self-signed dev certificate for HTTPS :8443
│   │       └── static/          # Frontend HTML/CSS/JS (Manager, Scanner, Admin, Verify)
│   └── test/                    # End-to-end integration test suite
├── docs/
│   └── use-case/                # UML use case diagrams, viewer & specifications
├── data/                        # Persistent local H2 database, keys & private rosters (gitignored)
├── pom.xml                      # Maven project configuration
└── README.md                    # Project documentation & team instructions
```

---

## 👥 Authors & Academic Context

Developed as an academic capstone and institutional demonstration project for **Bicol University Polangui**.

**Happy Testing & Presenting!** 🚀
