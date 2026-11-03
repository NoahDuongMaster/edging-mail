# ⚡ edging-mail

> **100% Serverless Edge Webmail running entirely on Cloudflare Workers, D1, R2, and Email Routing.**
> *Zero servers. Zero cold starts. Zero dollars to get started.*

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)
![Storage: Cloudflare D1 & R2](https://img.shields.io/badge/Storage-D1%20%26%20R2-orange.svg)

---

## ✨ Features

- **100% Edge Powered**: Runs entirely inside Cloudflare Workers compute and edge infrastructure.
- **Cloudflare Email Routing Native**: Ingests incoming emails via the native `email()` Worker event binding without any third-party mail server.
- **RFC 822 MIME Parser**: Fast, edge-compatible MIME parsing via `postal-mime` (extracts plain text, HTML, and attachments).
- **D1 SQLite Database**: High-speed indexing for messages, threads, folders (`inbox`, `sent`, `starred`, `archive`, `trash`, `spam`), and search.
- **R2 Blob Storage**: Stores raw `.eml` files and all attachments with zero egress fees.
- **Outbound Email**: Supports Cloudflare's `send_email` Workers binding with standard RFC 5322 MIME packaging via `mimetext`.
- **Modern React + Tailwind UI**: Fast SPA built with React 19, Tailwind CSS v4, Lucide icons, dark mode, keyboard-friendly UI, and live attachment downloads.
- **Built-in Inbound Simulator**: Test incoming email processing and indexing immediately without needing live MX records configured yet.

---

## 🏗️ Architecture

```
               [ Inbound Email (SMTP) ]
                          │
                          ▼
            [ Cloudflare Email Routing ]
                          │
                          ▼ (Worker email() hook)
               ┌──────────────────────┐
               │   edging-mail Core   │
               │ (Cloudflare Worker)  │
               └──────────┬───────────┘
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
  [ Cloudflare D1 ]                 [ Cloudflare R2 ]
   Messages, Threads,                Raw .eml files,
   Folders, Metadata                 Attachments
         ▲                                 ▲
         └────────────────┬────────────────┘
                          │ (REST API & Assets)
                          ▼
               [ React Edge Webmail UI ]
```

---

## 🚀 Quick Start

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/your-username/edging-mail.git
cd edging-mail
npm install
```

### 2. Set Up Local Cloudflare D1 & R2

Execute the SQLite migration locally:

```bash
npm run db:migrate:local
```

### 3. Build & Run Locally

To build the client SPA and start the Worker with local D1 and R2 emulation:

```bash
# Build client assets
npm run build

# Start Cloudflare Worker dev server
npm run worker:dev
```

Open `http://localhost:8787` in your browser. You can immediately click **"Simulate Inbound"** in the sidebar to generate incoming mock emails and test parsing, indexing, and viewing!

---

## ☁️ Production Deployment

### 1. Create Cloudflare Resources

```bash
# 1. Create Cloudflare D1 Database
npx wrangler d1 create edging_mail_db

# 2. Create Cloudflare R2 Bucket
npx wrangler r2 bucket create edging-mail-storage
```

Copy the generated `database_id` from the D1 output into `wrangler.jsonc`.

### 2. Apply Remote Schema

```bash
npm run db:migrate:remote
```

### 3. Deploy to Cloudflare Edge

```bash
npm run deploy
```

### 4. Configure Cloudflare Email Routing

1. Open **Cloudflare Dashboard &rarr; Your Domain &rarr; Email Routing**.
2. Click **Enable Email Routing** (Cloudflare will automatically set up your MX and SPF DNS records).
3. In **Routing Rules**, create a rule:
   - **Custom address**: `*@yourdomain.com` (catch-all or custom address)
   - **Action**: **Send to a Worker** &rarr; Select `edging-mail`
4. Save and you're all set! Any email sent to your domain will now route directly into your `edging-mail` inbox.

---

## 📜 License

MIT License. Free to use, fork, and self-host on Cloudflare.
