"""Read-only public-source research; writes evidence only beside this script."""
import concurrent.futures, datetime, html, json, re, urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
DATE = datetime.datetime.now(datetime.timezone.utc).isoformat()

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ANASAQ-planning-research/1.0"})
    with urllib.request.urlopen(req, timeout=35) as response:
        return response.read().decode("utf-8", errors="replace")

def save_doc(pair):
    name, url = pair
    try:
        data = fetch(url)
        content = re.search(r"<main\b.*?</main>", data, re.S) or re.search(r"<article\b.*?</article>", data, re.S)
        text = content.group() if content else data
        text = re.sub(r"<(script|style)\b.*?</\1>", "", text, flags=re.S)
        text = re.sub(r"</(?:p|div|h[1-6]|li|tr|pre|section|article)>", "\n", text)
        text = html.unescape(re.sub(r"<[^>]+>", "", text))
        text = re.sub(r"\n\s*\n+", "\n\n", text)
        (ROOT / (name + ".txt")).write_text(f"Source: {url}\nRetrieved UTC: {DATE}\nMethod: public HTTP GET; HTML tags removed, no authenticated access.\n\n{text}", encoding="utf-8")
        return name, len(data), len(text)
    except Exception as exc:
        (ROOT / (name + ".txt")).write_text(f"Source: {url}\nRetrieved UTC: {DATE}\nAccess failed: {exc}\n", encoding="utf-8")
        return name, str(exc)

if __name__ == "__main__":
    docs = {
        "commerce-moyasar-auth": "https://docs.moyasar.com/api/authentication",
        "commerce-moyasar-idempotency": "https://docs.moyasar.com/api/idempotency",
        "commerce-moyasar-fetch-payment": "https://docs.moyasar.com/api/payments/02-fetch-payment",
        "commerce-moyasar-refund": "https://docs.moyasar.com/api/payments/05-refund-payment",
        "commerce-moyasar-status": "https://docs.moyasar.com/api/payments/payment-status-reference",
        "commerce-moyasar-webhook": "https://docs.moyasar.com/api/other/webhooks/webhook-reference",
        "commerce-moyasar-webhook-create": "https://docs.moyasar.com/api/other/webhooks/create-webhook",
        "commerce-moyasar-webhook-dashboard": "https://docs.moyasar.com/guides/dashboard/setting-up-webhooks",
        "commerce-moyasar-environments": "https://docs.moyasar.com/getting-started/test-vs-live-environments",
        "commerce-moyasar-go-live": "https://docs.moyasar.com/getting-started/go-live-checklist",
        "commerce-moyasar-apple-web": "https://docs.moyasar.com/guides/apple-pay/apple-pay-web",
        "commerce-moyasar-apple-registration": "https://docs.moyasar.com/guides/apple-pay/web-registration",
        "commerce-moyasar-invoice": "https://docs.moyasar.com/api/invoices/01-create-invoice",
        "commerce-moyasar-form": "https://docs.moyasar.com/guides/references/form-configuration",
        "commerce-stream-home": "https://stream.sa",
        "commerce-stream-docs": "https://docs.stream.sa",
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for result in pool.map(save_doc, docs.items()):
            print(result)
