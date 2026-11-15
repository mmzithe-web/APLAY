-- جدول آهنگ‌ها
create table tracks (
  id bigint generated always as identity primary key,
  title text not null,
  artist text default 'ناشناس',
  moods text[] default '{}',
  file_path text not null
);
alter table tracks enable row level security;
create policy "logged in users read tracks" on tracks for select to authenticated using (true);

-- محدودیت پیام روزانه
create table usage (user_id uuid, day date, n int default 0, primary key (user_id, day));
alter table usage enable row level security;
create function bump_usage() returns int language plpgsql security definer as $$
declare c int;
begin
  insert into usage(user_id, day, n) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set n = usage.n + 1 returning n into c;
  return c;
end $$;

-- فضای ذخیره‌ی آهنگ‌ها
insert into storage.buckets (id, name, public) values ('music', 'music', true) on conflict do nothing;
