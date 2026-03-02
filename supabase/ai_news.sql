-- AI News table for Supabase
-- Run this in Supabase SQL Editor

-- Create ai_news table
create table ai_news (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  summary text not null,
  source_url text not null unique,
  source_name text,
  published_at timestamp with time zone,
  collected_at timestamp with time zone default now(),
  category text default 'other',
  translation_status text default 'completed' check (translation_status in ('pending', 'completed')),
  original_title text,
  original_summary text
);

-- Enable RLS (Row Level Security)
alter row level security;

-- Create index table ai_news enable for faster queries
create index idx_ai_news_collected_at on ai_news(collected_at desc);
create index idx_ai_news_category on ai_news(category);
create index idx_ai_news_translation_status on ai_news(translation_status);

-- RLS Policy: Allow public read access
create policy "Allow public read access to ai_news"
  on ai_news for select
  using (true);

-- RLS Policy: Allow service role to insert/update
-- Note: This will be bypassed when using SUPABASE_SERVICE_ROLE_KEY
create policy "Allow service role to insert ai_news"
  on ai_news for insert
  with check (true);

create policy "Allow service role to update ai_news"
  on ai_news for update
  using (true);
