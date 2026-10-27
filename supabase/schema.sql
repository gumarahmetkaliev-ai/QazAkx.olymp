-- QazAKx user progress. Run once in Supabase SQL Editor.
-- RLS: users can only access their own rows.

create table if not exists public.user_progress (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  olympiad_id text not null,
  task_id text not null,
  answer text,
  parts jsonb default '{}'::jsonb,
  status text,
  ai_result jsonb,
  score integer,
  last_saved timestamptz default now(),
  checked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, olympiad_id, task_id)
);

create index if not exists user_progress_user_id_idx on public.user_progress (user_id);
create index if not exists user_progress_checked_at_idx on public.user_progress (user_id, checked_at);

alter table public.user_progress enable row level security;

drop policy if exists "user_progress_select_own" on public.user_progress;
create policy "user_progress_select_own"
  on public.user_progress
  for select
  using (auth.uid() = user_id);

drop policy if exists "user_progress_insert_own" on public.user_progress;
create policy "user_progress_insert_own"
  on public.user_progress
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_progress_update_own" on public.user_progress;
create policy "user_progress_update_own"
  on public.user_progress
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_progress_delete_own" on public.user_progress;
create policy "user_progress_delete_own"
  on public.user_progress
  for delete
  using (auth.uid() = user_id);
