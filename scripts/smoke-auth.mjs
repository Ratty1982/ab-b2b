import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.env.APP_URL ?? "http://127.0.0.1:43127";
const password = process.env.DEV_SEED_PASSWORD ?? "DevOnly-ChangeMe-Phase1!";
const outDir = "/opt/cursor/artifacts/screenshots";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

function pathOf() {
  return new URL(page.url()).pathname;
}

async function login(email) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
  await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 15000 });
}

async function signOut() {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 15000 });
}

const results = [];

await page.goto(`${base}/portal`, { waitUntil: "networkidle" });
results.push({
  step: "anonymous_portal",
  url: page.url(),
  ok: pathOf().startsWith("/login") && page.url().includes("returnTo"),
});
await page.screenshot({ path: `${outDir}/phase1-anon-portal-redirect.png`, fullPage: true });

await login("trade.buyer@example.invalid");
results.push({ step: "buyer_portal", url: page.url(), ok: pathOf().startsWith("/portal") });
const buyerHeader = await page.locator("header").innerText();
results.push({
  step: "buyer_name",
  ok: buyerHeader.includes("Dan Reeves") && buyerHeader.includes("Sign out"),
  text: buyerHeader.slice(0, 240),
});
await page.screenshot({ path: `${outDir}/phase1-buyer-portal.png`, fullPage: true });

await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 15000 });
results.push({
  step: "buyer_admin_denied",
  url: page.url(),
  ok: !pathOf().startsWith("/admin"),
});
await page.screenshot({ path: `${outDir}/phase1-buyer-admin-denied.png`, fullPage: true });

await signOut();

await login("sales.rep@example.invalid");
results.push({ step: "rep_sales", url: page.url(), ok: pathOf().startsWith("/sales") });
await page.screenshot({ path: `${outDir}/phase1-sales-rep.png`, fullPage: true });

await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 15000 });
results.push({
  step: "rep_admin_denied",
  url: page.url(),
  ok: !pathOf().startsWith("/admin"),
});
await page.screenshot({ path: `${outDir}/phase1-rep-admin-denied.png`, fullPage: true });

await signOut();

await login("superadmin@example.invalid");
await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 15000 });
results.push({
  step: "super_admin",
  url: page.url(),
  ok: pathOf().startsWith("/admin"),
});
await page.screenshot({ path: `${outDir}/phase1-super-admin.png`, fullPage: true });

console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("ALL SMOKE CHECKS PASSED");
await browser.close();
