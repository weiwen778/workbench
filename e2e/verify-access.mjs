import { chromium } from "playwright"
const url = "http://127.0.0.1:18080/"
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 760 } })
const resp = await p.goto(url, { waitUntil: "networkidle" })
console.log("status=", resp && resp.status(), "title=", await p.title(), "url=", p.url())
await p.screenshot({ path: "/home/weiwen/workbench/docs/screenshots/20-访问验证.png" })
await b.close()
