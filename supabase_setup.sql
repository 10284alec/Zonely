-- ── ZONELY DATABASE SETUP ──
-- Run this entire script in Supabase → SQL Editor → New query

-- 1. PROFILES TABLE
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);


-- 2. PLACELISTS TABLE
create table if not exists placelists (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  description text,
  is_public boolean default false,
  cover_image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table placelists enable row level security;

create policy "Users can view own placelists"
  on placelists for select
  using (auth.uid() = user_id or is_public = true);

create policy "Users can insert own placelists"
  on placelists for insert
  with check (auth.uid() = user_id);

create policy "Users can update own placelists"
  on placelists for update
  using (auth.uid() = user_id);

create policy "Users can delete own placelists"
  on placelists for delete
  using (auth.uid() = user_id);


-- 3. PINS TABLE
create table if not exists pins (
  id uuid default gen_random_uuid() primary key,
  placelist_id uuid references placelists on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  address text,
  note text check (char_length(note) <= 280),
  rating integer check (rating >= 1 and rating <= 5) not null,
  latitude float8 not null,
  longitude float8 not null,
  google_place_id text,
  created_at timestamptz default now()
);

alter table pins enable row level security;

create policy "Users can view pins in accessible placelists"
  on pins for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from placelists
      where placelists.id = pins.placelist_id
      and placelists.is_public = true
    )
  );

create policy "Users can insert own pins"
  on pins for insert
  with check (auth.uid() = user_id);

create policy "Users can update own pins"
  on pins for update
  using (auth.uid() = user_id);

create policy "Users can delete own pins"
  on pins for delete
  using (auth.uid() = user_id);


-- 4. AUTO-CREATE PROFILE ON SIGNUP
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();


-- Done! All tables and policies created.
