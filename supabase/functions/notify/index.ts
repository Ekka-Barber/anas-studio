// The `notify` Edge Function (P08, D32). Round 0 placeholder: the endpoint is
// declared in supabase/config.toml and answers 503 until its round delivers
// the handler in `../_shared/` (PLANS/P08-CONTRACT.md, section 7).
Deno.serve(() =>
  Response.json(
    { ok: false, error: { code: 'UNAVAILABLE', message: 'تعذّر إكمال الإجراء.' }, requestId: crypto.randomUUID() },
    { status: 503, headers: { 'cache-control': 'no-store' } },
  ),
)
