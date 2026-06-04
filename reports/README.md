# Reports (local only)

ผล review เก็บที่นี่บนเครื่องคุณ — **ไม่ commit ขึ้น Git** (ดู `.gitignore`)

## Layout

```
reports/
  index.json      # catalog (สร้างอัตโนมัติ)
  index.html      # dashboard (ไฟล์เดียวที่อยู่ใน repo)
  {owner}/
    {repo}/
      pr-{number}.md
      pr-{number}.json
```

## View reports

- **Local UI:** `npm run ui` → แท็บ Reports
- **Browser:** `npx serve reports` แล้วเปิด `index.html`

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `REPORTS_DIR` | `./reports` | Where to write reports |
| `POST_PR_COMMENT` | `false` | Post full review on PR |
| `POST_PR_LINK` | `false` | Post short link to report on PR |
| `TARGET_REPOSITORY` | `GITHUB_REPOSITORY` | Repo to review (`owner/repo`) |
| `REVIEW_CWD` | workspace | Checkout path for Cursor agent |
