# nexo CASP v8.0 — Pinpad Simulator

A professional-grade, web-based simulator for the **nexo Retailer Protocol (CASP) v8.0**, designed for QA teams to test POS-to-POI payment terminal integrations without physical hardware.

![nexo Simulator](https://img.shields.io/badge/nexo-CASP%20v8.0-38bdf8?style=for-the-badge) ![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js) ![WebSocket](https://img.shields.io/badge/WebSocket-Dual%20Server-818cf8?style=for-the-badge)

## Features

### 🖥️ Virtual Pinpad
- Realistic LCD screen with green phosphor text and scanline effects
- Full numeric keypad with Cancel, OK, Clear buttons
- Status LEDs (PWR, CONN, PROC) with real-time state updates
- PIN entry simulation with masking
- Receipt printer output

### 📡 Dual WebSocket Architecture
- **GUI WebSocket** (`:3000`) — Real-time browser UI updates
- **nexo Protocol WebSocket** (`:9000`) — External POS clients send/receive raw nexo XML

### 📋 Protocol Support
| Message | Code | Description |
|---------|------|-------------|
| Payment Request/Response | FSPQ/FSPP | Card payments with full device flow |
| Reversal Request/Response | FSRQ/FSRP | Transaction reversals |
| Balance Inquiry | FSIQ/FSIP | Card balance checks |
| Reconciliation | FSCQ/FSCP | Settlement with transaction totals |
| Login/Logout | SMIQ/SMOP | Session management |
| Diagnosis | SMDQ/SMDP | Terminal health checks |
| Display/Input/Print | DDYQ/DSIQ/DPRQ | Device service messages |
| Abort/MessageStatus | SSAB/SSSQ | System services |

### 🧪 Pre-Built Test Scenarios
1. **Happy Payment** — Login → Payment → Logout
2. **Payment Declined** — Login → Large amount declined → Logout
3. **Refund Flow** — Login → Refund → Logout
4. **Reconciliation** — Login → 2 Payments → Reconcile → Logout
5. **Diagnosis** — Login → Diagnosis → Logout
6. **Reversal** — Login → Payment → Reversal → Logout
7. **Multi-Payment** — Login → 3 Payments → Refund → Reconcile → Logout

### 🔧 Raw XML Testing
Built-in modal to send raw nexo XML directly to the protocol server with template generation for all message types.

## Installation

### Prerequisites

- **Node.js 18+** — [Download here](https://nodejs.org/) or install via a package manager:

```bash
# macOS (Homebrew)
brew install node

# Windows (winget)
winget install OpenJS.NodeJS.LTS

# Ubuntu / Debian
sudo apt update && sudo apt install nodejs npm
```

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/aryank97531/nexo-casp-simulator.git
cd nexo-casp-simulator

# 2. Install dependencies
npm install

# 3. Start the simulator
npm start
```

You should see:

```
  ╔══════════════════════════════════════════════════════╗
  ║  nexo CASP v8.0 Pinpad Simulator                    ║
  ║  GUI:      http://localhost:3000                    ║
  ║  nexo WS:  ws://localhost:9000  (XML protocol)    ║
  ╚══════════════════════════════════════════════════════╝
```

### Open in Browser

- **GUI** → [http://localhost:3000](http://localhost:3000)
- **nexo Protocol WebSocket** → `ws://localhost:9000`

## Connecting External POS Clients

```bash
# Using wscat
npx wscat -c ws://localhost:9000

# Send a login request
<SaleToPOISsnMgmtReq>
  <Hdr><MsgFctn>SARQ</MsgFctn><PrtcolVrsn>8.0</PrtcolVrsn>...</Hdr>
  <SsnMgmtReq><SvcCntt>SMIQ</SvcCntt>...</SsnMgmtReq>
</SaleToPOISsnMgmtReq>
```

```javascript
// From JavaScript
const ws = new WebSocket('ws://localhost:9000');
ws.onopen = () => ws.send(nexoXmlPayload);
ws.onmessage = (e) => console.log(e.data); // XML response
```

## Project Structure

```
├── server.js                  # Express + dual WebSocket server
├── src/
│   ├── nexo/
│   │   ├── constants.js       # All v8 protocol codes and enums
│   │   ├── protocol.js        # XML message builder
│   │   ├── simulator.js       # POI terminal response engine
│   │   └── validator.js       # Message validation
│   ├── nexo-ws-server.js      # External nexo protocol WS server
│   └── store.js               # In-memory transaction store
├── public/
│   ├── index.html             # SPA shell
│   ├── css/main.css           # Dark theme design system
│   └── js/app.js              # Frontend controller
└── package.json
```

## Configuration

Access via the **Config** button in the GUI:
- **Merchant Name** — Appears on receipts
- **Category Code (MCC)** — Merchant category
- **Country Code** — ISO country code
- **Response Delay** — Simulated processing time (ms)
- **Auto-Respond** — Toggle automatic POI responses

## Card Profiles

| Profile | PAN | Entry Mode |
|---------|-----|------------|
| Visa Credit (Chip) | 4111 11•• •••• 1111 | CICC |
| Visa Debit (Contactless) | 4000 00•• •••• 0002 | ECTL |
| Mastercard Credit | 5500 00•• •••• 0004 | CICC |
| Mastercard Contactless | 5400 00•• •••• 0005 | ECTL |
| American Express | 3782 82•• •••• 0005 | CICC |
| eftpos | 6200 00•• •••• 0001 | CICC |

## Tech Stack

- **Runtime**: Node.js
- **Server**: Express + ws
- **XML**: fast-xml-parser
- **Frontend**: Vanilla JS + CSS (no frameworks)
- **Fonts**: Inter + JetBrains Mono

## License

MIT
