# Predictive Maintenance System (PMS)

An AI-powered predictive maintenance platform for infrastructure monitoring. Upload logs from any source, get anomaly detection, failure predictions, and actionable insights.

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.2-blue)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Features

### Core Capabilities
- **Log-Agnostic Architecture** - Auto-detects and parses any log format (JSON, CSV, Syslog, Apache, Nginx, Windows Event, and more)
- **Compressed File Support** - Upload .gz, .zip, .tar.gz archives containing multiple log files
- **AI-Powered Predictions** - Isolation Forest anomaly detection with configurable sensitivity
- **Explainable AI** - 12 root-cause categories with causal chains, confidence breakdowns, and prioritized recommendations
- **Multi-Source Correlation** - Cross-correlate logs from different sources to identify cascade failures

### Database Ingestion (Phases 1–4)
- **MSSQL Connector** - SQL Agent job history, Query Store (with plan-regression detection), instrumented SP logging, wait stats, IO latency, Extended Events (deadlocks/timeouts), error log
- **PostgreSQL Connector** - pg_stat_statements, pg_stat_activity wait events, pg_stat_io
- **MySQL Connector** - performance_schema: statement digests, wait summaries, file IO summaries
- **Edge Collector** - `POST /api/ingest/batch` for on-prem agents that ship pre-mapped data over HTTPS
- **Scheduler** - Automated hourly pulls with Watermark-based cursors, per-feed cadence, and mutex-protected dispatch
- **Application-Centric UI** - All data sources and logs scoped under named Applications (Windows/Linux)

### Additional Features
- **Federated Learning UI** - Privacy-preserving model training concepts (simulation)
- **Industry Baseline Models** - Pre-configured models for Financial, Healthcare, E-Commerce, Manufacturing, and Telecom
- **Real-time Dashboard** - System health metrics, alerts, and prediction statistics with per-application filtering
- **Audit Trail** - Complete logging of user actions and system events
- **Model Performance Metrics** - Track accuracy, precision, recall over time

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL 14+
- Yarn package manager

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/predictive-maintenance-system.git
cd predictive-maintenance-system/nextjs_space

# Install dependencies
yarn install

# Copy environment template
cp .env.example .env
```

### Configure Environment

Edit `.env` with your settings:

```env
# Database (required)
DATABASE_URL="postgresql://username:password@localhost:5432/predictive_maintenance"

# Authentication (required)
NEXTAUTH_SECRET="generate-a-secure-random-string"
NEXTAUTH_URL="http://localhost:3000"

# Storage (choose one)
STORAGE_MODE="local"  # Use local file storage
# OR configure S3:
# STORAGE_MODE="s3"
# AWS_REGION="us-west-2"
# AWS_BUCKET_NAME="your-bucket"
# AWS_ACCESS_KEY_ID="your-key"
# AWS_SECRET_ACCESS_KEY="your-secret"
```

### Database Setup

```bash
# Generate Prisma client
yarn prisma generate

# Run migrations
yarn prisma migrate deploy

# Seed initial data (creates admin user)
yarn prisma db seed
```

### Run the Application

```bash
# Development mode
yarn dev

# Production build
yarn build
yarn start
```

Open [http://localhost:3000](http://localhost:3000)

**Default Login:** Username: `john` | Password: `johndoe123`

## 📁 Project Structure

```
nextjs_space/
├── app/                          # Next.js App Router
│   ├── (authenticated)/          # Protected routes
│   │   ├── applications/         # Application management (CRUD, tabs)
│   │   ├── dashboard/            # Main dashboard with app filter chips
│   │   ├── data-sources/         # Data source roll-up (read-only)
│   │   ├── upload/               # Log file upload
│   │   ├── predictions/          # Prediction history with app filter
│   │   ├── system-analysis/      # Multi-source analysis with app filter
│   │   ├── federated/            # Federated learning UI
│   │   ├── metrics/              # Model performance
│   │   └── audit/                # Audit trail
│   ├── api/
│   │   ├── applications/         # Application CRUD + summary + logs
│   │   ├── data-sources/         # Data source CRUD + test/run/feeds/runs
│   │   ├── ingest/batch/         # Edge collector batch ingest
│   │   ├── scheduler/run/        # Scheduler trigger endpoint
│   │   └── ...                   # Auth, upload, analysis, predictions, etc.
│   ├── login/
│   └── signup/
├── components/                   # Reusable UI components
├── lib/
│   ├── connectors/               # DB-agnostic connector registry
│   │   ├── types.ts              # DbConnector contract
│   │   ├── mssql.ts              # MSSQL connector (7 feeds)
│   │   ├── postgres.ts           # PostgreSQL connector (3 feeds)
│   │   ├── mysql.ts              # MySQL connector (3 feeds)
│   │   └── register.ts           # Auto-registration
│   ├── mappers/                  # Feed-specific data mappers
│   │   ├── mssql/                # job-history, query-store, sp-exec, wait-stats, io-stats, xevents, error-log
│   │   ├── postgres/             # query-stats, wait-events, io-stats
│   │   ├── mysql/                # query-digest, wait-summary, io-summary
│   │   └── cumulative.ts         # Shared cumulative-delta helper
│   ├── scheduler/dispatch.ts     # Watermark-based dispatcher
│   ├── detectors/                # Plan-regression detector
│   ├── crypto/dsn.ts             # AES-256-GCM secret encryption
│   ├── datasource/secrets.ts     # DataSource ↔ plaintext bridge
│   ├── explainable-ai.ts         # 12 root-cause patterns
│   ├── ml-model.ts               # Isolation Forest
│   ├── feature-extractor.ts      # Log feature extraction
│   ├── auto-detect-parser.ts     # Format auto-detection
│   └── storage.ts                # Unified S3/local storage
├── prisma/
│   └── schema.prisma             # Full schema (Application, DataSource, Watermark, IngestionRun, etc.)
├── scripts/
│   ├── seed.ts                   # Database seeding
│   ├── mssql-bootstrap.sql       # Phase 1 collector login
│   ├── mssql-bootstrap-phase2.sql # Query Store + SP exec log
│   ├── mssql-bootstrap-phase3.sql # DMV sanity check
│   └── mssql-bootstrap-phase4.sql # XE session creation
├── docs/
│   └── database-ingestion.md     # Full ingestion documentation
└── uploads/                      # Local file storage (gitignored)
```

## 🔧 Configuration

### Storage Modes

**Local Storage** (default for development):
```env
STORAGE_MODE="local"
```
Files are stored in `./uploads/` directory.

**AWS S3** (recommended for production):
```env
STORAGE_MODE="s3"
AWS_REGION="us-west-2"
AWS_BUCKET_NAME="your-bucket-name"
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
```

### Supported Log Formats

The system auto-detects these formats:
- **JSON** - Single objects or arrays, NDJSON/JSONL
- **CSV** - With header row
- **Syslog** - RFC 3164 and RFC 5424
- **Apache/Nginx** - Common and combined log formats
- **Windows Event** - Standard event log exports
- **Custom** - Pattern-based detection fallback

### Compressed Files

Supported archive formats:
- `.gz` / `.gzip` - Single compressed files
- `.zip` - Multiple files
- `.tar.gz` / `.tgz` - Compressed tar archives
- `.tar` - Uncompressed tar archives

## 📊 API Reference

### Authentication
- `POST /api/auth/login` - User login (username or email)
- `POST /api/signup` - User registration
- `GET /api/auth/session` - Current session

### Applications
- `GET /api/applications` - List applications
- `POST /api/applications` - Create application
- `GET /api/applications/[id]` - Get application
- `PATCH /api/applications/[id]` - Update application
- `DELETE /api/applications/[id]` - Delete application
- `GET /api/applications/[id]/summary` - Aggregated counts
- `GET /api/applications/[id]/logs` - Log files for application

### Data Sources
- `GET /api/data-sources` - List data sources (optional `?applicationId=`)
- `POST /api/data-sources` - Create data source (requires `applicationId`)
- `GET /api/data-sources/[id]` - Get data source
- `PATCH /api/data-sources/[id]` - Update data source
- `DELETE /api/data-sources/[id]` - Delete data source
- `POST /api/data-sources/[id]/test` - Test connection
- `POST /api/data-sources/[id]/run` - Trigger immediate pull
- `GET /api/data-sources/[id]/feeds` - List available feeds
- `GET /api/data-sources/[id]/runs` - Ingestion run history

### Ingestion
- `POST /api/ingest/batch` - Edge collector batch ingest (Bearer token or session)
- `GET /api/scheduler/run` - Trigger scheduler dispatch (session or `x-pms-scheduler-key`)

### File Operations
- `POST /api/upload/presigned` - Get upload URL
- `PUT /api/upload/local` - Upload to local storage
- `POST /api/upload/complete` - Process uploaded file
- `GET /api/files/serve` - Download file

### Analysis
- `GET /api/system-analysis` - Run system analysis (optional `?applicationId=`)
- `GET /api/predictions` - List predictions (optional `?applicationId=`)
- `GET /api/dashboard` - Dashboard metrics (optional `?applicationId=`)
- `GET /api/metrics` - Model performance
- `GET /api/audit` - Audit trail

## 🛠 Development

### Running Tests

```bash
# Type checking
yarn tsc --noEmit

# Linting
yarn lint
```

### Database Management

```bash
# Create migration
yarn prisma migrate dev --name migration_name

# Reset database
yarn prisma migrate reset

# Open Prisma Studio
yarn prisma studio
```

### Adding New Log Formats

1. Add detection logic in `lib/auto-detect-parser.ts`
2. Add parsing logic in `lib/log-parser.ts`
3. Update feature extraction in `lib/feature-extractor.ts`

## 🚢 Deployment

### Vercel

1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy

### Docker (coming soon)

```bash
docker build -t pms .
docker run -p 3000:3000 --env-file .env pms
```

### Manual Production

```bash
yarn build
NODE_ENV=production yarn start
```

## 🔐 Security

- Passwords hashed with bcrypt
- Session-based authentication via NextAuth.js
- File path sanitization prevents directory traversal
- Role-based access control (admin/user)
- DataSource secrets encrypted at rest with AES-256-GCM (`PMS_DSN_KEY`)
- Edge collector API secured with Bearer token (`EDGE_COLLECTOR_KEY`)
- Scheduler endpoint secured with shared key (`SCHEDULER_TRIGGER_KEY`)
- Multi-tenant isolation via `organizationId` on all data models

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📧 Support

For questions or issues, please open a GitHub issue.
