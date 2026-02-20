# 📞 Telnyx OpenClaw AI

A high-performance, containerized Voice AI assistant powered by **Telnyx**, **OpenAI Whisper**, and **OpenClaw**. 


## 🚀 Quick Start

### 1. Configure
Clone `.env.example` to `.env` and fill in your keys:
```bash
cp .env.example .env
```

### 2. Run with Docker
```bash
docker-compose up -d
```

### 3. Run Locally
```bash
npm install
node index.js
```

---

## 🛠️ Infrastructure

| Port | Description |
| :--- | :--- |
| **3023** | Local Webhook Server |
| **18789** | OpenClaw Gateway (Backend) |


---
*Built with ❤️ by [Neo](https://github.com/neooriginal)*
