# Supabase Project Setup for QazAKx.olymp

This file describes the manual steps that must be completed in the Supabase dashboard and Google Cloud Console to fully activate the production auth and cloud progress features. These steps are NOT performed by this codebase automatically.

---

## 1. Create a new Supabase Project

1. Go to https://supabase.com and create a new project.
2. Note the Project URL (e.g., https://<project>.supabase.co) and the `anon` / `publishable` key.

---

## 2. Configure Authentication (Google OAuth)

1. In the Supabase Dashboard: Authentication > Providers > Google.
2. Toggle Google to Enabled.
3. Go to https://console.cloud.google.com and create a new OAuth 2.0 Client ID for a Web application.
4. In the Client ID settings, add Authorized Redirect URI:

```
[SUPABASE_PROJECT_URL]/auth/v1/callback
```

Example: if your project URL is https://xyz.supabase.co, add:
https://xyz.supabase.co/auth/v1/callback

5. Copy the Client ID and Client Secret into the Supabase Google provider fields.
6. Leave redirect URLs empty in the Supabase provider; the project-level callback handles it.

---

## 3. Configure Redirect URLs for Production

The application uses:

```
window.location.origin + "/auth/callback"
```

After deploying to Vercel, the domain will be something like https://qazakxolymp.vercel.app.
Make sure the following redirect URLs are added to the Supabase Auth settings (Authentication > URL Configuration):

- Site URL: https://qazakxolymp.vercel.app (or your custom domain)
- Redirect URLs: https://qazakxolymp.vercel.app/auth/callback

Also keep a localhost redirect for development if needed:
- http://localhost:3000/auth/callback

---

## 4. Create the user_progress table and RLS

In the Supabase SQL Editor, run the SQL file:

```
supabase/schema.sql
```

This creates:
- `public.user_progress` table
- RLS policies for SELECT, INSERT (WITH CHECK), UPDATE, DELETE
- Indexes for user_id and checked_at

---

## 5. Configure Vercel Environment Variables

In the Vercel Dashboard for this project (gumarahmetkaliev-ais-projects/qazakx_olymp):

1. Go to Project > Settings > Environment Variables.
2. Add:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon_key_from_project_settings>
```

3. Mark them as Production (optional but recommended).
4. Do NOT add service-role keys here.

---

## 6. Verify Auth Flow Manually

After deploying:

1. Click "Continue with Google" in the app.
2. Complete the OAuth consent screen.
3. The user should be redirected back to `/auth/callback`.
4. Check the account section for avatar/email.
5. Check that progress sync occurs (localStorage updates and Supabase table has rows).

---

## Final Notes

- This architecture is production-ready but depends on the manual steps above.
- No fake credentials or hardcoded localhost URLs are used in production logic.
- The code uses `window.location.origin` for redirect flexibility.
