-- Phase 4: mark which usage rows cost money. Free real services (built-in code,
-- YouTube search within its free quota) are recorded with paid = false, so they
-- never count towards spending or the daily budget.
alter table public.provider_usage
  add column paid boolean not null default false;

update public.provider_usage set paid = true where is_mock = false and provider <> 'built-in';
