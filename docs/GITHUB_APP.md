# GitHub App — review หลาย repo อัตโนมัติ (optional)

> **ไม่จำเป็นถ้าใช้ local เป็นหลัก** — ใช้ `npm run ui` หรือ `npm run review:local` แทนได้  
> เอกสารนี้สำหรับตอนที่ต้องการ webhook อัตโนมัติบนหลาย repo (ต้อง tunnel หรือ server สาธารณะ)

ติดตั้ง GitHub App บน org/repo ที่ต้องการ → เมื่อมี PR ระบบจะ review และเก็บ report ใน `reports/` ของ hub นี้

## 1. สร้าง GitHub App

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**
2. ตั้งชื่อ เช่น `review-code-ai`
3. **Webhook URL** (local ใช้ tunnel):
   - Production: `https://your-server.com/api/github/webhook`
   - Local: `https://xxxx.ngrok-free.app/api/github/webhook` (ดูข้อ 4)
4. **Webhook secret** — สุ่มแล้วเก็บใน `.env` เป็น `GITHUB_APP_WEBHOOK_SECRET`
5. **Permissions**
   - Repository → **Pull requests**: Read & write (ถ้าจะ inline comment)
   - Repository → **Contents**: Read (clone / read files)
   - Metadata: Read
6. **Subscribe to events**: `Pull request`
7. สร้างแล้วดาวน์โหลด **Private key** (.pem)

## 2. ตั้งค่า `.env`

```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=./github-app.private-key.pem
GITHUB_APP_WEBHOOK_SECRET=your-webhook-secret

CURSOR_API_KEY=cursor_...

# หลัง review โพสต์ลิงก์บน PR
GITHUB_APP_POST_PR_LINK=true
GITHUB_APP_POST_INLINE=false

# commit report เข้า hub repo (ต้อง git remote พร้อม push)
HUB_AUTO_COMMIT=false

WEBHOOK_PORT=4040
```

## 3. รัน webhook server

```powershell
npm run webhook
```

- Health: http://127.0.0.1:4040/health
- Jobs: http://127.0.0.1:4040/api/github/jobs

## 4. Local tunnel (ngrok)

```powershell
ngrok http 4040
```

เอา URL ไปใส่ Webhook URL ใน GitHub App settings

## 5. ติดตั้ง App บน org/repo

GitHub App → **Install App** → เลือก `Tech-Merch` หรือ repo ที่ต้องการ

## 6. ทดสอบ

เปิด/อัปเดต PR ใน repo ที่ติดตั้ง → webhook รับ event → ดู log ที่ terminal `npm run webhook` และ report ใน `reports/`

## เทียบกับ repository_dispatch

| วิธี | ข้อดี |
|------|------|
| **GitHub App** | ติดตั้งครั้งเดียวหลาย repo, ไม่ต้อง copy workflow |
| **dispatch** | ไม่ต้องสร้าง App, ใช้ PAT + workflow ในแต่ละ repo |

## Troubleshooting

- `401 invalid signature` — webhook secret ไม่ตรง
- `CURSOR_API_KEY is not set` — ใส่ใน `.env` แล้ว restart webhook
- ไม่มี report — ดู `/api/github/jobs` หรือ log ใน terminal
