# Reports

AI review results are saved here instead of (or in addition to) long PR comments.

## Layout

```
reports/
  index.json      # catalog for the dashboard
  index.html      # open in browser (GitHub Pages or locally)
  {owner}/
    {repo}/
      pr-{number}.md
```

## View reports

- **GitHub:** browse `reports/` in this repo, or open `reports/index.html` via [GitHub Pages](https://pages.github.com/) if enabled.
- **Local:** run a review, then open `reports/index.html` in a browser (needs a local server for `index.json`, or use `npx serve reports`).

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `REPORTS_DIR` | `./reports` | Where to write reports |
| `POST_PR_COMMENT` | `false` | Post full review on PR |
| `POST_PR_LINK` | `false` | Post short link to report on PR |
| `TARGET_REPOSITORY` | `GITHUB_REPOSITORY` | Repo to review (`owner/repo`) |
| `REVIEW_CWD` | workspace | Checkout path for Cursor agent |
