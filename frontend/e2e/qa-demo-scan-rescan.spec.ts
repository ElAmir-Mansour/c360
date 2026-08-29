import { expect, test, type Page, type Response } from "@playwright/test";
import path from "path";

const DEMO_ORIGIN = "https://demo.clario360.sa";
const QA_EMAIL = process.env.CLARIO_QA_EMAIL;
const QA_PASSWORD = process.env.CLARIO_QA_PASSWORD;
const FIXTURE = path.resolve(
  process.cwd(),
  "../docs/ClarioWatheeq/Najiz_Nafath_Integration_Test_Plan.docx",
);
const QA_FILENAME = `QA_scan_rescan_${Date.now()}.docx`;
const SCREENSHOT = path.resolve(
  process.cwd(),
  "../artifacts/client-attachment-demo/scan-clean-live-demo.png",
);

type JsonObject = Record<string, unknown>;

function unwrap(payload: unknown): JsonObject {
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    (payload as { data?: unknown }).data &&
    typeof (payload as { data: unknown }).data === "object"
  ) {
    return (payload as { data: JsonObject }).data;
  }
  return (payload ?? {}) as JsonObject;
}

async function login(page: Page) {
  if (!QA_EMAIL || !QA_PASSWORD) {
    throw new Error("CLARIO_QA_EMAIL and CLARIO_QA_PASSWORD are required");
  }

  await page.context().addCookies([
    {
      name: "clario360_locale",
      value: "en",
      domain: "demo.clario360.sa",
      path: "/",
      secure: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`${DEMO_ORIGIN}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(QA_EMAIL);
  await page.locator("#password").fill(QA_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/lex(?:[/?#]|$)/, { timeout: 30_000 }),
    page.getByRole("button", { name: /sign in|تسجيل الدخول/i }).click(),
  ]);
}

async function reachAttachments(page: Page) {
  await page.goto(`${DEMO_ORIGIN}/lex/service-desk/new`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 60_000,
  });

  const discardDraft = page.getByRole("button", {
    name: /Discard|تجاهل|حذف المسودة/i,
  });
  if (await discardDraft.isVisible().catch(() => false)) {
    await discardDraft.click();
  }

  const firstService = page.getByRole("radio").first();
  await expect(firstService).toBeVisible({ timeout: 30_000 });
  await firstService.check();
  await page
    .getByRole("button", {
      name: /Next:\s*Request Details|التالي:\s*تفاصيل الطلب/i,
    })
    .click();

  await page
    .getByRole("textbox", {
      name: /Request Title|Title \(English\)|عنوان الطلب|العنوان/i,
    })
    .first()
    .fill(`QA antivirus scan ${Date.now()}`);
  await page
    .getByRole("textbox", { name: /Description|الوصف/i })
    .fill("Controlled QA upload to verify antivirus scan and rescan state transitions.");

  const department = page.getByRole("combobox", {
    name: /Beneficiary department|الجهة.*الإدارة|الإدارة المستفيدة/i,
  });
  await department.click();
  await page.getByRole("option").first().click();

  await page
    .getByLabel(/Requested due date|تاريخ الاستحقاق المطلوب/i)
    .fill("2026-08-15");
  await page
    .getByRole("button", {
      name: /Next:\s*Attachments|التالي:\s*المرفقات/i,
    })
    .click();
}

test("demo upload and rescan complete with a clean antivirus verdict", async ({ page }) => {
  test.setTimeout(180_000);

  let fileId = "";
  let apiHeaders: Record<string, string> = {};
  let cleanupHttpStatus: number | null = null;
  const observedUploadPollStatuses: string[] = [];
  const observedRescanStatuses: string[] = [];

  await login(page);
  await reachAttachments(page);

  let uploadResponse: Response | undefined;
  const uploadPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/files/upload" &&
      response.request().method() === "POST",
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: QA_FILENAME,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await import("fs/promises").then((fs) => fs.readFile(FIXTURE)),
  });
  uploadResponse = await uploadPromise;
  expect(uploadResponse.status()).toBe(201);

  const uploadPayload = unwrap(await uploadResponse.json());
  fileId = String(uploadPayload.id ?? "");
  expect(fileId).toBeTruthy();
  const uploadInitialStatus = String(uploadPayload.virus_scan_status ?? "");
  expect(uploadInitialStatus).toBe("pending");

  const uploadHeaders = await uploadResponse.request().allHeaders();
  apiHeaders = Object.fromEntries(
    ["authorization", "x-csrf-token", "x-locale"]
      .filter((key) => uploadHeaders[key])
      .map((key) => [key, uploadHeaders[key]]),
  );
  expect(apiHeaders.authorization).toBeTruthy();

  const row = page.getByText(QA_FILENAME, { exact: true }).locator("..").locator("..");
  await expect(row).toContainText(/Completed|Valid|Clean|اكتمل|صالح|سليم/i, {
    timeout: 30_000,
  });
  observedUploadPollStatuses.push("clean");

  const nextButton = page.getByRole("button", {
    name: /Next:\s*Review & Confirm|التالي:\s*المراجعة والتأكيد/i,
  });
  const nextEnabledWhenClean = await nextButton.isEnabled();
  expect(nextEnabledWhenClean).toBe(true);

  const rescanResponse = await page.request.post(
    `${DEMO_ORIGIN}/api/v1/files/${fileId}/rescan`,
    { headers: apiHeaders },
  );
  const rescanHttpStatus = rescanResponse.status();
  const rescanPayload = unwrap(await rescanResponse.json());
  expect(rescanResponse.ok()).toBe(true);
  expect(String(rescanPayload.status ?? "")).toBe("rescan_queued");

  const pollDeadline = Date.now() + 30_000;
  let postRescanFinalStatus = "";
  while (Date.now() < pollDeadline) {
    const response = await page.request.get(
      `${DEMO_ORIGIN}/api/v1/files/${fileId}`,
      { headers: apiHeaders },
    );
    expect(response.ok()).toBe(true);
    const payload = unwrap(await response.json());
    const status = String(payload.virus_scan_status ?? "");
    if (
      status &&
      observedRescanStatuses[observedRescanStatuses.length - 1] !== status
    ) {
      observedRescanStatuses.push(status);
    }
    if (["clean", "infected", "error", "skipped"].includes(status)) {
      postRescanFinalStatus = status;
      break;
    }
    await page.waitForTimeout(500);
  }
  expect(postRescanFinalStatus).toBe("clean");

  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  await nextButton.click();
  await expect(
    page.getByRole("button", { name: /Submit Request|إرسال الطلب/i }),
  ).toBeVisible({ timeout: 30_000 });
  const advancedToReview = true;

  const backButton = page.getByRole("button", {
    name: /Back to Attachments|Back|السابق|العودة إلى المرفقات/i,
  });
  await backButton.click();

  const deleteResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/files/${fileId}` &&
      response.request().method() === "DELETE",
  );
  await page
    .getByRole("button", {
      name: new RegExp(`Remove ${QA_FILENAME}|إزالة ${QA_FILENAME}`, "i"),
    })
    .click();
  cleanupHttpStatus = (await deleteResponse).status();
  expect(cleanupHttpStatus).toBe(200);

  console.log(
    "DEMO_CLEAN_SCAN_RESCAN_QA",
    JSON.stringify({
      uploadHttpStatus: uploadResponse.status(),
      uploadInitialStatus,
      observedUploadPollStatuses,
      rescanHttpStatus,
      rescanResponseStatus: String(rescanPayload.status ?? ""),
      observedRescanStatuses,
      postRescanFinalStatus,
      displaysClean: true,
      nextEnabledWhenClean,
      advancedToReview,
      cleanupHttpStatus,
      screenshot: SCREENSHOT,
    }),
  );
});
