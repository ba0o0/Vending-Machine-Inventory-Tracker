# UMBC VMIT — Vending Machine Inventory Tracker

A web-based dashboard for UMBC Campus Card Services staff to monitor vending machine inventory in real time, replacing manual spreadsheet-based workflows.

---

## Overview

VMIT provides two access levels:

- **Admin** — full read/write access; can create machines, add/edit items, and upload transaction data
- **Guest** — read-only view of all vending machine inventory

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript (vanilla) |
| Backend / Database | Firebase Firestore |
| Auth | Firebase Authentication |
| Hosting | Firebase Hosting |
| PDF Parsing | PDF.js (cdnjs) |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (via nvm recommended)
- [Firebase CLI](https://firebase.google.com/docs/cli)

```bash
npm install -g firebase-tools
```

### Setup

1. Clone the repository and navigate to the project root.

2. Log in to Firebase:

```bash
firebase login
# If using WSL:
firebase login --no-localhost
```

3. Start the local emulator:

```bash
firebase emulators:start
```

4. Open `http://localhost:5000` in your browser.

## CSV Formats

### Items File (for creating a machine)

| Column | Accepted Header Names |
|---|---|
| Slot | `row`, `slot`, `slotLabel` |
| Product | `product`, `item`, `name` |
| Price | `vendingPrice`, `price` |

Example:
```
Row,Product,Vending Price
A1,Chips,$1.50
A2,Soda,$1.75
```

### Transaction File (for updating inventory)

| Column | Accepted Header Names |
|---|---|
| Machine ID | `machineId`, `machine` |
| Slot | `slot`, `slotLabel`, `row` |
| Qty Sold | `qtySold`, `quantity`, `sold`, `qty` |

Example:
```
machineId,slot,qtySold
abc123,A1,3
abc123,A2,1
```

Transactions are matched to items using the `machineId` + `slotLabel` composite key.


## Status Indicators

| Color | Meaning |
|---|---|
| 🟢 Green | Restocked within the last 14 days / item quantity above threshold |
| 🟠 Orange | Restocked 15–30 days ago / item quantity at or below threshold |
| ⚫ Gray | No restock date recorded / item quantity is zero |

---

## Team

CMSC-447 Software Engineering — Team 5, UMBC  
Stakeholder: Erin McGonigle, Campus Card Services (CBOC/CBORD)
