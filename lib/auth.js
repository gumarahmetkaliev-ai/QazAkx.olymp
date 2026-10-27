/**
 * QazAKx Auth helpers — no password storage.
 * Safe for Node tests and browser (via public/js/auth-client.js).
 */

function getAuthRedirectTo(origin) {
  const base = String(origin || "").replace(/\/+$/, "");
  return `${base}/auth/callback`;
}

function isPublishableKey(value) {
  const key = String(value || "").trim();
  if (!key) return false;
  if (/service[_-]?role/i.test(key)) return false;
  return true;
}

function publicSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(
    env.SUPABASE_PUBLISHABLE_KEY ||
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      env.SUPABASE_ANON_KEY ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      ""
  ).trim();
  return {
    configured: Boolean(url && isPublishableKey(key)),
    url: url || "",
    publishableKey: isPublishableKey(key) ? key : "",
    redirectPath: "/auth/callback",
    resetPath: "/auth/reset",
  };
}

function parseRlsSql(sql) {
  const text = String(sql || "");
  return {
    rlsEnabled: /enable row level security/i.test(text),
    select: /create policy[\s\S]*for select[\s\S]*using \(auth\.uid\(\) = user_id\)/i.test(text),
    insert: /create policy[\s\S]*for insert[\s\S]*with check \(auth\.uid\(\) = user_id\)/i.test(text),
    update: /create policy[\s\S]*for update[\s\S]*using \(auth\.uid\(\) = user_id\)[\s\S]*with check \(auth\.uid\(\) = user_id\)/i.test(text),
    delete: /create policy[\s\S]*for delete[\s\S]*using \(auth\.uid\(\) = user_id\)/i.test(text),
  };
}

module.exports = {
  getAuthRedirectTo,
  isPublishableKey,
  publicSupabaseConfig,
  parseRlsSql,
};
