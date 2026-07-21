begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'reference-videos',
    'reference-videos',
    false,
    104857600,
    array['video/mp4', 'video/quicktime', 'video/webm']
  ),
  (
    'voice-recordings',
    'voice-recordings',
    false,
    26214400,
    array['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'video/webm', 'video/mp4']
  )
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies are created intentionally. The browser never talks
-- to Storage directly; Express uses the server-only service_role key and returns
-- short-lived signed URLs after validating the custom family session.

commit;
