-- Phase 5: a PRIVATE storage bucket for project pictures.
--
-- Files are stored at "<owner_id>/<project_id>/<asset_id>.<ext>". Only the backend
-- (with the secret key) reads and writes them, and it checks that each picture
-- belongs to the signed-in user, so no storage policies for browsers are needed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-assets', 'project-assets', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
