# review-code-ai

AI **Pull Request review** ด้วย [Cursor SDK](https://cursor.com/docs/sdk/typescript) — รันบนเครื่องคุณ เก็บผลเป็น report ใน `reports/` (ไม่ spam ความยาวบน PR โดยค่าเริ่มต้น)

---

## เริ่มใช้บนเครื่อง (แนะนำ)

### สิ่งที่ต้องมี

| รายการ | หมายเหตุ |
|--------|----------|
| **Node.js 20+** | `node -v` |
| **Cursor API key** | [Dashboard → Integrations](https://cursor.com/dashboard/integrations) |
| **GitHub** | `gh auth login` หรือใส่ `GITHUB_TOKEN` ใน `.env` (อ่าน PR / clone repo อื่น) |

### 1. ติดตั้ง

```powershell
git clone https://github.com/tonsappza/review-code-ai.git
cd review-code-ai
npm install
```

### 2. ตั้งค่า `.env`

```powershell
copy .env.example .env
```

แก้อย่างน้อย 3 ค่านี้:

```env
CURSOR_API_KEY=cursor_xxx
TARGET_REPOSITORY=Tech-Merch/big-data-api
PR_NUMBER=24
UI_PORT=4000
REVIEW_MODE=explore
```

> ไม่ต้อง commit ไฟล์ `.env` — มีแค่ในเครื่องคุณ

### 3. เปิด Local UI

```powershell
npm run ui
```

เปิดเบราว์เซอร์: **http://127.0.0.1:4000** (ตาม `UI_PORT`)

### 4. รัน review

1. เลือก **Repository**:
   - **จาก GitHub** — กด **โหลด** → เลือก repo จากบัญชีที่ login (`gh auth` / `GITHUB_TOKEN`)
   - **พิมพ์เอง** — ใส่ `owner/repo` ตรงๆ
2. เลือกวิธีระบุ PR:
   - **ใส่เลข PR** — พิมพ์เลขเอง (เช่น `24`)
   - **โหลดจาก GitHub** — เลือกสถานะ (open/ทั้งหมด) → กด **โหลด** → เลือกจาก dropdown
3. กด **เริ่ม Review** → ดู log สดใน panel ซ้าย
4. เมื่อเสร็จ → แท็บ **Reports** (มือถือ: bottom nav) → เลือก report ดูรายละเอียด

### 5. ดูผล

| ที่ | ไฟล์ / หน้า |
|-----|----------------|
| ใน UI | แท็บ Reports → คลิกรายการ |
| ในโฟลเดอร์ | `reports/owner/repo/pr-N.md` และ `pr-N.json` |
| Dashboard | เปิด `reports/index.html` (หรือ `npx serve reports`) |

```text
reports/
  Tech-Merch/big-data-api/
    pr-24.md      ← สรุป review (markdown)
    pr-24.json    ← findings + verdict (pass/warn/fail)
  index.json      ← รายการสำหรับ UI (local เท่านั้น — ไม่ commit, สร้างจาก pr-*.json)
```

---

## Local UI — สรุปหน้าจอ

| ส่วน | ทำอะไร |
|------|--------|
| **Review** | ฟอร์มรัน review + log สด |
| **Reports** | ประวัติ report ใน hub นี้ |
| **ค้นหา report** (ด้านบน Reports) | หา report จากชื่อ repo / PR / verdict |
| **ค้นหา repository** (ตอนโหลดจาก GitHub) | กรอง dropdown — จัดกลุ่มตาม **owner** |
| **กรอง findings** (ใน report) | กรอง severity ของ issue ใน report นั้น (แสดงเมื่อมี findings) |
| **เปิด PR ↗** | ลิงก์ไป PR บน GitHub |
| **ปุ่มธีม** (มุมขวาบน) | สลับ Light / Dark |

**ทิป:** ใช้ PR ที่ยัง **open** จะได้ผล review ที่ตรงกับงานปัจจุบัน; PR ที่ merge แล้วยัง review ได้แต่ใช้ทดสอบ / ดูประวัติ

---

## วิธีรันแบบอื่น (ไม่เปิด UI)

### สคริปต์ (อ่าน `.env` อัตโนมัติ)

```powershell
npm run review:local
```

clone PR ไป `.review-target/` → review → บันทึก `reports/` → **ลบ `.review-target` อัตโนมัติ** (แม้ error) · ตั้ง `KEEP_REVIEW_TARGET=true` เฉพาะ debug

### CLI ตรงๆ

```powershell
$env:CURSOR_API_KEY="cursor_..."
$env:GITHUB_TOKEN="$(gh auth token)"
$env:GITHUB_REPOSITORY="owner/repo"
$env:PR_NUMBER="42"
npm run review
```

---

## ตั้งค่าที่ใช้บ่อย (local)

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|--------|-------------|----------|
| `CURSOR_API_KEY` | — | **จำเป็น** |
| `TARGET_REPOSITORY` | — | `owner/repo` ที่จะ review |
| `PR_NUMBER` | — | เลข PR (สำหรับ `review:local` / ค่าเริ่มต้นใน UI) |
| `UI_PORT` | `3847` | พอร์ต Local UI |
| `REVIEW_MODE` | `explore` | `explore` = อ่าน repo + diff · `diff` = diff อย่างเดียว |
| `REVIEW_MODEL` | (default SDK) | เช่น `composer-2.5` |
| `POST_PR_LINK` | `false` | โพสต์ลิงก์ report สั้นๆ บน PR |
| `POST_INLINE_COMMENTS` | `false` | inline comment บน GitHub (critical/major + มีบรรทัด) |
| `INCREMENTAL_REVIEW` | `false` | เทียบกับ report ครั้งก่อนของ PR เดียวกัน |
| `CHUNK_DIFF_THRESHOLD` | `45000` | PR ใหญ่ → review แยกตามไฟล์ |
| `KEEP_REVIEW_TARGET` | `false` | เก็บโฟลเดอร์ `.review-target` หลัง review |

ดูครบใน [`.env.example`](.env.example)

---

## แก้ปัญหาเบื้องต้น

| อาการ | แนวทาง |
|--------|--------|
| UI ไม่ขึ้น / พอร์ตชน | เปลี่ยน `UI_PORT` แล้วรัน `npm run ui` ใหม่ |
| โหลด PR ว่าง | ใส่ `owner/repo` ให้ถูก · เลือกสถานะ **ทั้งหมด** ถ้า PR merge แล้ว · รีสตาร์ท UI หลังแก้โค้ด |
| `CURSOR_API_KEY missing` | ใส่ใน `.env` แล้ว restart `npm run ui` |
| GitHub auth | `gh auth login` หรือ `GITHUB_TOKEN` ใน `.env` |
| รายการ PR / report ไม่อัปเดต | Hard refresh เบราว์เซอร์ (Ctrl+Shift+R) |

```powershell
npm run typecheck
npm test
```

---

## ฟีเจอร์ (ภาพรวม)

- Structured findings → `pr-N.json` + verdict `pass` / `warn` / `fail`
- Chunked review สำหรับ PR ใหญ่
- Incremental review เทียบ report เก่า
- Review repo **อื่น** ได้จากเครื่องเดียว — report เก็บใน hub นี้
- (ทางเลือก) โพสต์ลิงก์หรือ inline comments บน PR เป้าหมาย

---

## ทางเลือก — CI / Hub / GitHub App

> **ไม่จำเป็นถ้าใช้ local เป็นหลัก**

### PR ใน repo นี้

Workflow [`.github/workflows/pr-review.yml`](.github/workflows/pr-review.yml) — review PR ของ hub แล้ว commit เข้า `reports/`

### PR ใน repo อื่น (repository_dispatch)

ใส่ workflow บน repo เป้าหมาย → ยิงมาที่ `review-code-ai` → ดู [Quick start เดิมใน commit history](https://github.com/tonsappza/review-code-ai) หรือตัวอย่างใน `.github/workflows/review-dispatch.yml`

ต้องมี secrets: `CURSOR_API_KEY`, `REVIEW_GITHUB_TOKEN`, `REVIEW_DISPATCH_TOKEN`

### GitHub App (อัตโนมัติหลาย repo)

คู่มือ: [docs/GITHUB_APP.md](docs/GITHUB_APP.md) — `npm run webhook` + tunnel (ngrok)

---

## Security

- อย่า commit `.env` หรือ API keys
- เนื้อหา diff ถูกส่งไป Cursor API เพื่อ inference
- อย่าใส่ secrets ใน PR ที่จะถูก review / commit ลง `reports/`

## License

MIT
