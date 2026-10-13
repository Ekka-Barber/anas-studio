# Admin redesign: what must not change (from the admin e2e specs, read 2026-10-08)

The specs cannot run in the cloud; the owner runs them locally before acceptance. Every rule below is a selector or assertion a spec relies on.

## The shell
- Exactly ONE `<nav>` on every admin screen (`page.locator('nav').getByRole('link', {name})` clicks; a second nav with the same links = strict-mode violation). Its accessible name stays «لوحة التحكم» (`nav[aria-label="لوحة التحكم"]`).
- The nav's links are exactly today's, in today's order: `nav[aria-label="لوحة التحكم"] a` allTextContents → «الطلبات» directly after «المتجر» (orders-admin.spec.ts:1234). NO extra `<a>` inside the nav (a logo link, a «لوحة أنس» home link, a skip link) unless the order check still holds AND no spec compares the whole list (check before adding: grep allTextContents).
- The sign-out stays a `<button>` named «تسجيل الخروج» INSIDE the nav (auth.spec.ts:45, owner-operations:660, store-admin:308).
- Role gating of links unchanged (operations: no «المحتوى»; editor: no «الطلبات»; the nav visible for every role, `toBeVisible()` at default viewport).
- At phone widths the specs check: no page overflow (scrollWidth ≤ innerWidth), no table scrolling sideways inside `main [class*="tableWrap"]`, no `tbody button` off screen, 44px targets (expectTargets: buttons, inputs, a[href], checkbox labels).

## main
- `main` is the one `<main id="main">`; screens render inside it.
- Do NOT add `<section>` elements in main: specs count them (`main section` toHaveCount(0) on no-access and failed states) and filter them by their h2 (`main section` filter has h2 name).
- Do NOT add `<ul>` before a screen's content in main: `main ul` .first() is the order header's facts list (orders-admin 580, 653, 676-678, 1009, 1080, 1089, 1116, 1302); AdminHome's orders section: `ul` first/nth(1) li texts (1190, 1201, 1311); `section('الطلبات') ul` count 0 when failed (1215).
- `main h2` texts, in order, are asserted on the order view (577, 1257) and reconciliation (orders-money 1095): no new h2 in main; no h2 renamed.
- `main table` count 0 in no-access/failed states: no decorative tables.
- `p:not([role])` inside AdminHome's «المتجر» section (store-admin 1329): adding a plain `<p>` there changes the drawn list (compared before/after an action: stable, but keep it out anyway).

## Class-name substrings the specs select by (CSS module local names)
- `[class*="listItem"]` (cards in order view and reconciliation: orders-admin 268, orders-money 181, 1140); `[class*="field"]` filtered by label (orders-money 187: matches ANY class containing "field": never add a new class containing "field" on a wrapper of a field, e.g. no `fieldRow`, `fieldGroup`); `[class*="secret"]` (the TOTP secret text, innerText read: keep only the secret's characters inside it); `[class*="tableWrap"]` (overflow check: keep the wrapper class on each table's scroll box).
- So: keep the class names `listItem`, `field`, `secret`, `tableWrap`, and do not introduce other class names containing those substrings.

## Forms and lists (cms.spec)
- A list field's group (`getByRole('group', {name})`) has its items as DIRECT `div` children (`group.locator('> div')`, nth indexing): no wrapper div between the group and its items, no extra direct div children (headers, toolbars) in the group.
- The «أعلى» button per item, «إخفاء» checkboxes, labels («الشبكة»، «المعرّف»، «الرابط»، «العنوان»، «الاسم»، «التعليق»): unchanged names.
- `page.locator('table')` (version history) count = 1 on the edit screen: no other table there.

## Tables
- `tbody tr`, `td[data-label="…"]` (all labels), `thead th` texts and counts (refunds th 7/8), `td[data-label="النوع"] span[dir="ltr"]`, `[data-label="الرمز"]`: unchanged markup; style only.

## Text
- Every visible string the specs read (getByText with exact regexes: e.g. /^تحتاج حلًا: [\d,]+ · للشحن: [\d,]+ · دفعات قيد المراجعة: [\d,]+$/ on one element; «الحالة: …» inside the first ul) stays in ONE element with the same text: do not split a sentence into styled spans if a spec matches it with an anchored regex on one element (getByText matches the element's own full text).
