# Ringba Scrub Platform v2.0

A full-stack Node.js + React platform that:
1. **Fetches phone numbers** from the Ringba API on a scheduled basis
2. **Generates TXT files** and saves numbers to MongoDB
3. **Scrubs uploaded files** against DNC lists and campaign databases
4. **Supports publisher management** with per-campaign permissions
5. **Processes millions of rows** with real-time Socket.IO progress

---

## Architecture Overview

```
ringba-scrub-platform/
├── server.js                   # Express + Socket.IO entry point
├── config/
│   ├── db.js                   # MongoDB connection
│   └── constants.js            # Campaign mappings, available campaigns
├── models/
│   ├── Call.js                 # Ringba fetched numbers
│   ├── DNC.js                  # Do-not-call list
│   ├── File.js                 # Generated TXT files
│   ├── Job.js                  # Ringba fetch scheduler jobs
│   ├── Publisher.js            # Publisher accounts (NEW)
│   └── ScrubJob.js             # File scrub jobs (NEW)
├── services/
│   ├── ringbaService.js        # Ringba API client (preserved)
│   ├── dncService.js           # DNC file upload/processing (preserved)
│   ├── fileService.js          # TXT file generation (preserved)
│   ├── jobService.js           # Ringba job helpers (preserved)
│   ├── scrubService.js         # Core scrub engine (NEW)
│   └── buyerApiService.js      # ACA CPL Scrub buyer API (NEW)
├── controllers/
│   ├── adminController.js      # Publisher CRUD (NEW)
│   ├── publisherController.js  # Scrub upload/download (NEW)
│   └── ...                     # Preserved controllers
├── cron/
│   ├── fetchCron.js            # Daily Ringba fetch (preserved)
│   └── autoDeleteCron.js       # File cleanup (preserved)
├── utils/
│   ├── phoneNormalizer.js      # US phone normalization (NEW)
│   └── ...                     # Preserved utils
└── frontend/
    └── src/
        ├── pages/Admin.jsx     # Publisher management UI (NEW)
        ├── pages/Publisher.jsx # Scrub workflow UI (NEW)
        └── ...                 # Preserved pages
```

---

## Quick Start

### 1. Install dependencies
```bash
npm run setup          # installs backend + frontend deps
# OR separately:
npm install
cd frontend && npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your MongoDB URI and Ringba credentials
```

### 3. Build frontend
```bash
cd frontend && npm run build
```

### 4. Start server
```bash
npm start              # production
npm run dev            # development with nodemon
```

### 5. Development (hot-reload frontend)
```bash
# Terminal 1
npm run dev

# Terminal 2
cd frontend && npm run dev
```

Open http://localhost:5173 for development, http://localhost:5000 for production.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `MONGODB_URI` | MongoDB connection string | required |
| `RINGBA_API_URL` | Ringba report API URL | required |
| `RINGBA_TOKEN` | Ringba API token | required |
| `PORT` | Server port | `5000` |
| `APP_TIMEZONE` | Scheduler timezone | `Asia/Karachi` |
| `CORS_ORIGIN` | Allowed origins (comma-separated) | `http://localhost:5173` |
| `FILE_RETENTION_DAYS` | Days to keep generated files | `7` |
| `BUYER_API_CONCURRENCY` | Max concurrent buyer API calls | `10` |
| `BUYER_API_TIMEOUT_MS` | Buyer API timeout per call | `5000` |

---

## Campaign Configuration

| Publisher Campaign | Internal DB Campaign | Buyer API |
|---|---|---|
| FE | FE | No |
| SSDI | SSDI | No |
| ACA CPL | ACAXfers | No |
| ACA CPL Scrub (AOBG) | ACAXfers | Yes |
| Medicare | MedicareXfersCPL | No |

### ACA CPL Scrub Logic
1. Check internal DB (ACAXfers campaign)
2. If NOT in DB → call `https://hcs.tldcrm.com/api/public/dialer/ready/{number}?qui=27053&adg=true`
3. If `{"ready":0}` → Duplicate
4. If `{"ready":1}` → Not Duplicate

---

## Daily Fetch & Ringba Upload Automation

The daily cron (`cron/fetchCron.js`) is fully product-driven via
`config/constants.js` → `PRODUCTS`. For each active product it:

1. **Fetches** numbers from every enabled source
2. **Saves** a per-source snapshot to MongoDB (`Call` collection)
3. **Combines** → normalizes → dedupes → removes DNC numbers
4. **Writes** the final list to the product's Google Sheet tab
5. **Generates** a suppression `.txt` file
6. **Uploads** that file to Ringba as a **Bulk Tag** and re-points every
   enabled ping-tree **Target** for that product at the new tag

### Products & sources

| Product | Sources | Sheet tab |
|---|---|---|
| **ACA** | Ringba (campaign contains `ACA`, paid, last 30d) + QC tools (last 6 months, `Sales`, `ACA`) + CallGrid *(stubbed/skipped)* | `Database` |
| **SSDI** | QC tools only (last 6 months, `Sales`/paid, `SSDI`) | `SSDI` |

To change windows, search terms, paid/disposition filters, or add a
source, edit `PRODUCTS` in `config/constants.js`.

### Data sources

- **Ringba report API** — `services/ringbaService.js` (Token auth). Used for
  the ACA paid-call fetch.
- **QC tools** — `services/qcToolsService.js`. Logs in to
  `callcheckai.com`, caches the JWT, and pulls the `callerId` column from the
  CSV export.
- **CallGrid** — `services/callGridService.js`. **Not wired up yet** — it is a
  safe stub that returns nothing unless `CALLGRID_API_BASE` /
  `CALLGRID_API_TOKEN` are configured and the source is enabled.

### Ringba Bulk Tag upload (`services/ringbaUploadService.js`)

Uses the account-scoped v2 API (**Bearer** auth — separate from the report
API). Per target:

1. `POST /bulkTags { name, csv_list }` → new `bulkTagUpload.id`
2. `GET /pingtreetargets/{id}` → full target object
3. Replace `criteria[*].bulkCriteria.id` with the new bulk tag id
4. `PATCH /pingtreetargets/{id}` with the full object

### Managing targets

Add the Ringba ping-tree target IDs that should receive each product's file on
the **🎯 Targets** admin page (or via the `/api/targets` endpoints). Each row
maps `product → ringbaTargetId` and shows the last upload status / Bulk Tag id.
Use **Run Now** to trigger the whole pipeline on demand.

---

## Processing Pipeline

```
Uploaded Row
    │
    ▼
Phone Normalization
    │ Remove non-digits
    │ Strip leading 1 from 11-digit
    │ Invalid if <10 or >10 digits
    ▼
DNC Check (FIRST, always)
    │ Checked against DNC collection
    │ Format: +1XXXXXXXXXX
    │
    ├─ DNC? → status = "DNC" (STOP)
    │
    ▼
Campaign DB Check (batch, indexed)
    │ Call collection by campaignName
    │
    ├─ Found? → status = "Duplicate" (STOP)
    │
    ▼
Buyer API Check (ACA CPL Scrub only)
    │ Max 10 concurrent requests
    │ Timeout: 5 seconds per call
    │ Error → assume Not Duplicate
    │
    ├─ ready=0? → status = "Duplicate"
    └─ ready=1? → status = "Not Duplicate"
```

---

## Performance Design

### Large File Handling
- **CSV**: Streamed with `csv-parser` — zero full-file memory loading
- **XLSX/XLS**: Loaded via `xlsx` library (memory-bound; use CSV for multi-million-row files)
- **Batch size**: 500 rows per processing cycle
- **Output**: Written row-by-row via streaming WriteStream

### Database Efficiency
- **Phone field indexed** on Call model: `{ phoneNumber: 1, campaignName: 1 }`
- **DNC field uniquely indexed**: `{ phoneNumber: 1 }`
- **Batch DB queries**: 500 numbers per `$in` query instead of per-row queries

### Buyer API Concurrency
- `ConcurrentPool` class limits to `BUYER_API_CONCURRENCY` (default 10) simultaneous requests
- Avoids overwhelming the external API
- 5-second timeout per request with fallback to "Not Duplicate" on error

### Concurrent Jobs
- Each scrub job runs in its own async chain
- Multiple publishers can upload simultaneously
- Socket.IO rooms isolate per-job progress events

---

## API Endpoints

### Admin
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/publishers` | List all publishers + available campaigns |
| POST | `/api/admin/publishers` | Create publisher |
| PUT | `/api/admin/publishers/:id` | Update publisher |
| DELETE | `/api/admin/publishers/:id` | Delete publisher |

### Publisher Scrub
| Method | Path | Description |
|---|---|---|
| POST | `/api/publisher/verify` | Verify publisher name |
| POST | `/api/publisher/upload` | Upload file + start scrub job |
| GET | `/api/publisher/job/:jobId` | Get job status + stats |
| GET | `/api/publisher/job/:jobId/download` | Download scrubbed CSV |
| GET | `/api/publisher/jobs` | List recent jobs |

### Targets (Ringba upload automation)
| Method | Path | Description |
|---|---|---|
| GET | `/api/targets` | List Ringba targets + available products |
| POST | `/api/targets` | Create a target (name, product, ringbaTargetId) |
| PUT | `/api/targets/:id` | Update a target |
| DELETE | `/api/targets/:id` | Delete a target |
| POST | `/api/targets/run` | Trigger the full fetch → file → sheet → Ringba upload now |

### Existing (Preserved)
| Method | Path | Description |
|---|---|---|
| GET/POST | `/api/schedule` | Ringba fetch schedule |
| POST | `/api/dnc/upload` | Upload DNC file |
| GET | `/api/files` | List generated TXT files |
| GET | `/api/files/:id/download` | Download TXT file |
| DELETE | `/api/files/:id` | Delete TXT file |
| GET | `/api/dashboard` | Dashboard stats |

---

## Socket.IO Events

### Client → Server
```js
socket.emit('join:job', jobId);   // Subscribe to job progress
socket.emit('leave:job', jobId);  // Unsubscribe
```

### Server → Client (`scrub:progress`)
```js
// Event: started
{ event: 'started', totalRows: 150000, campaign: 'FE', phoneColumnDetected: 'phone' }

// Event: progress (emitted every 1000 rows)
{ event: 'progress', totalRows, processedRows, duplicateCount,
  dncCount, invalidCount, nonDuplicateCount, completionPercent }

// Event: completed
{ event: 'completed', ...stats, downloadFilePath: 'scrubbed_..._output.csv', completionPercent: 100 }

// Event: failed
{ event: 'failed', error: 'Error message' }
```

---

## Output File Format

All original columns are preserved + `scrub_status` column is appended:

| original_col_1 | original_col_2 | phone | ... | scrub_status |
|---|---|---|---|---|
| ... | ... | 5551234567 | ... | Not Duplicate |
| ... | ... | 5559876543 | ... | DNC |
| ... | ... | 5551111111 | ... | Duplicate |
| ... | ... | 123 | ... | Invalid Number |

Output is always CSV regardless of input format.

---

## Phone Number Detection

Automatically detects these column names (case-insensitive):
- `phonenumber`
- `phone`
- `phone number`
- `number`
- `callerid`
- `callerId`

---

## DNC Format Note

The DNC service stores numbers as `+1XXXXXXXXXX`. The scrub service normalizes all input numbers to 10-digit format and converts to `+1XXXXXXXXXX` for DNC lookups automatically.

---

## MongoDB Indexes

```
Call:  { phoneNumber: 1, campaignName: 1 }  (unique)
Call:  { phoneNumber: 1 }
Call:  { campaignName: 1 }
DNC:   { phoneNumber: 1 }  (unique)
```

For best scrub performance on large datasets, ensure MongoDB indexes are built:
```js
// In mongo shell
db.calls.createIndex({ phoneNumber: 1, campaignName: 1 })
db.dncs.createIndex({ phoneNumber: 1 }, { unique: true })
```
