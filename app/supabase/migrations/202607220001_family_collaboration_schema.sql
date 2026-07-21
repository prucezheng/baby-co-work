begin;

create extension if not exists pgcrypto with schema extensions;

create type public.time_slot as enum ('morning', 'daytime', 'evening', 'night');
create type public.member_experience as enum ('beginner', 'basic', 'experienced', 'professional');
create type public.member_preference as enum ('lead', 'assist', 'simple');
create type public.task_input_type as enum ('text', 'voice');
create type public.task_status as enum (
  'pending',
  'in_progress',
  'completed',
  'skipped',
  'affected',
  'cancelled'
);
create type public.subtask_source as enum ('ai', 'user', 'knowledge');
create type public.knowledge_note_kind as enum ('step', 'preparation', 'notice', 'safety');
create type public.attachment_status as enum ('uploading', 'processing', 'ready', 'failed', 'expired');
create type public.voice_recording_status as enum ('uploaded', 'transcribing', 'transcribed', 'failed', 'expired');
create type public.completion_event_type as enum ('completed', 'undo', 'skipped', 'reassigned');
create type public.completion_source as enum ('self', 'substitute', 'automatic');
create type public.achievement_scope as enum ('member', 'family');

create table public.families (
  id uuid primary key default gen_random_uuid(),
  display_name varchar(40) not null check (char_length(btrim(display_name)) between 1 and 40),
  invite_token_hash varchar(128) not null unique check (char_length(invite_token_hash) between 32 and 128),
  creator_member_id uuid,
  timezone varchar(64) not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  display_name varchar(20) not null check (char_length(btrim(display_name)) between 1 and 20),
  role varchar(20) not null check (char_length(btrim(role)) between 1 and 20),
  pin_hash text not null check (char_length(pin_hash) >= 20),
  identity_claimed boolean not null default false,
  experience public.member_experience,
  available_slots public.time_slot[] not null default '{}',
  limitations text[] not null default '{}',
  preference public.member_preference not null default 'assist',
  temporary_unavailable boolean not null default false,
  pin_failed_attempts smallint not null default 0 check (pin_failed_attempts between 0 and 5),
  pin_locked_until timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_members_available_slots_limit check (cardinality(available_slots) <= 4),
  constraint family_members_limitations_limit check (cardinality(limitations) <= 10),
  constraint family_members_family_name_key unique (family_id, display_name),
  constraint family_members_family_id_id_key unique (family_id, id)
);

alter table public.families
  add constraint families_creator_member_fk
  foreign key (creator_member_id)
  references public.family_members(id)
  on delete restrict
  deferrable initially deferred;

create table public.member_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  member_id uuid not null,
  token_hash char(64) not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint member_sessions_member_fk
    foreign key (family_id, member_id)
    references public.family_members(family_id, id)
    on delete cascade,
  constraint member_sessions_expiry_after_creation check (expires_at > created_at)
);

create table public.task_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  creator_member_id uuid not null,
  request_id varchar(120) not null check (char_length(btrim(request_id)) between 1 and 120),
  input_type public.task_input_type not null,
  raw_input varchar(500) not null check (char_length(btrim(raw_input)) between 2 and 500),
  recording_duration_sec smallint,
  transcript varchar(500),
  created_at timestamptz not null default now(),
  constraint task_requests_creator_fk
    foreign key (family_id, creator_member_id)
    references public.family_members(family_id, id)
    on delete restrict,
  constraint task_requests_family_request_key unique (family_id, request_id),
  constraint task_requests_family_id_id_key unique (family_id, id),
  constraint task_requests_voice_fields_check check (
    (
      input_type = 'text'
      and recording_duration_sec is null
      and transcript is null
    )
    or
    (
      input_type = 'voice'
      and recording_duration_sec between 1 and 60
      and char_length(btrim(transcript)) between 2 and 500
    )
  )
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  task_request_id uuid,
  created_by_member_id uuid not null,
  title varchar(50) not null check (char_length(btrim(title)) between 1 and 50),
  raw_input varchar(500) not null check (char_length(btrim(raw_input)) between 2 and 500),
  input_type public.task_input_type not null,
  assignee_member_id uuid,
  due_at timestamptz,
  duration_min smallint not null check (duration_min between 1 and 120),
  completion_criteria varchar(300) not null check (char_length(btrim(completion_criteria)) between 1 and 300),
  assignment_reason varchar(150) not null check (char_length(btrim(assignment_reason)) between 1 and 150),
  status public.task_status not null default 'pending',
  safety_notice varchar(300),
  manually_assigned boolean not null default false,
  locked_by_user boolean not null default false,
  version integer not null default 1 check (version >= 1),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_request_fk
    foreign key (family_id, task_request_id)
    references public.task_requests(family_id, id)
    on delete set null (task_request_id),
  constraint tasks_creator_fk
    foreign key (family_id, created_by_member_id)
    references public.family_members(family_id, id)
    on delete restrict,
  constraint tasks_assignee_fk
    foreign key (family_id, assignee_member_id)
    references public.family_members(family_id, id)
    on delete set null (assignee_member_id),
  constraint tasks_family_id_id_key unique (family_id, id),
  constraint tasks_completed_at_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  family_id uuid not null,
  title varchar(50) not null check (char_length(btrim(title)) between 1 and 50),
  position smallint not null check (position between 1 and 6),
  required boolean not null default true,
  source public.subtask_source not null,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subtasks_task_fk
    foreign key (family_id, task_id)
    references public.tasks(family_id, id)
    on delete cascade,
  constraint subtasks_task_position_key unique (task_id, position),
  constraint subtasks_completed_at_check check (
    (completed and completed_at is not null)
    or (not completed and completed_at is null)
  )
);

create table public.knowledge_entries (
  id varchar(120) primary key check (char_length(btrim(id)) between 1 and 120),
  title varchar(100) not null check (char_length(btrim(title)) between 1 and 100),
  keywords text[] not null default '{}',
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  preparations jsonb not null default '[]'::jsonb check (jsonb_typeof(preparations) = 'array'),
  notices jsonb not null default '[]'::jsonb check (jsonb_typeof(notices) = 'array'),
  source_label varchar(200) not null check (char_length(btrim(source_label)) between 1 and 200),
  source_url text,
  conflict_group varchar(120),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_knowledge_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  family_id uuid not null,
  source_entry_id varchar(120) not null references public.knowledge_entries(id) on delete restrict,
  note_text varchar(300) not null check (char_length(btrim(note_text)) between 1 and 300),
  kind public.knowledge_note_kind not null,
  conflict boolean not null default false,
  position smallint not null check (position between 1 and 10),
  source_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(source_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint task_knowledge_notes_task_fk
    foreign key (family_id, task_id)
    references public.tasks(family_id, id)
    on delete cascade,
  constraint task_knowledge_notes_task_position_key unique (task_id, position)
);

create table public.voice_recordings (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  task_request_id uuid,
  bucket_id text not null default 'voice-recordings' check (bucket_id = 'voice-recordings'),
  object_path text not null unique check (object_path !~ '(^|/)\.\.(/|$)'),
  mime_type varchar(80) not null check (
    mime_type in ('audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'video/webm', 'video/mp4')
  ),
  file_size bigint not null check (file_size between 1 and 26214400),
  duration_sec smallint not null check (duration_sec between 1 and 60),
  status public.voice_recording_status not null default 'uploaded',
  expires_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint voice_recordings_request_fk
    foreign key (family_id, task_request_id)
    references public.task_requests(family_id, id)
    on delete set null (task_request_id),
  constraint voice_recordings_expiry_check check (expires_at > created_at)
);

create table public.reference_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  family_id uuid not null,
  bucket_id text not null default 'reference-videos' check (bucket_id = 'reference-videos'),
  object_path text not null unique check (object_path !~ '(^|/)\.\.(/|$)'),
  file_name varchar(255) not null check (char_length(btrim(file_name)) between 1 and 255),
  mime_type varchar(20) not null check (mime_type in ('mp4', 'mov', 'webm')),
  file_size bigint not null check (file_size between 1 and 104857600),
  note varchar(100),
  status public.attachment_status not null default 'uploading',
  expires_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_attachments_task_fk
    foreign key (family_id, task_id)
    references public.tasks(family_id, id)
    on delete cascade,
  constraint reference_attachments_task_key unique (task_id),
  constraint reference_attachments_expiry_check check (expires_at > created_at)
);

create table public.completion_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  task_id uuid not null,
  assignee_member_id uuid,
  actor_member_id uuid not null,
  event_type public.completion_event_type not null,
  completion_source public.completion_source,
  substitute_reason varchar(120),
  occurred_at timestamptz not null default now(),
  task_version integer not null check (task_version >= 1),
  idempotency_key varchar(120) not null check (char_length(btrim(idempotency_key)) between 1 and 120),
  reverts_event_id uuid references public.completion_events(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  constraint completion_events_task_fk
    foreign key (family_id, task_id)
    references public.tasks(family_id, id)
    on delete cascade,
  constraint completion_events_actor_fk
    foreign key (family_id, actor_member_id)
    references public.family_members(family_id, id)
    on delete restrict,
  constraint completion_events_assignee_fk
    foreign key (family_id, assignee_member_id)
    references public.family_members(family_id, id)
    on delete set null (assignee_member_id),
  constraint completion_events_family_idempotency_key unique (family_id, idempotency_key),
  constraint completion_events_revert_key unique (reverts_event_id),
  constraint completion_events_source_check check (
    (event_type = 'completed' and completion_source is not null)
    or (event_type <> 'completed' and completion_source is null)
  ),
  constraint completion_events_substitute_reason_check check (
    (completion_source = 'substitute' and char_length(btrim(substitute_reason)) between 1 and 120)
    or (completion_source is distinct from 'substitute' and substitute_reason is null)
  ),
  constraint completion_events_revert_check check (
    (event_type = 'undo' and reverts_event_id is not null)
    or (event_type <> 'undo' and reverts_event_id is null)
  )
);

create table public.achievements (
  achievement_id varchar(80) not null check (char_length(btrim(achievement_id)) between 1 and 80),
  scope public.achievement_scope not null,
  owner_id uuid not null,
  family_id uuid not null references public.families(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  source_event_ids uuid[] not null check (cardinality(source_event_ids) >= 1),
  created_at timestamptz not null default now(),
  constraint achievements_owner_code_key primary key (scope, owner_id, achievement_id)
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  actor_member_id uuid,
  task_id uuid,
  activity_type varchar(40) not null check (
    activity_type in (
      'task_created', 'task_edited', 'task_reassigned', 'task_completed',
      'task_undone', 'task_skipped', 'member_unavailable', 'automatic_adjustment'
    )
  ),
  before_state jsonb,
  after_state jsonb,
  undo_expires_at timestamptz,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  constraint activity_logs_actor_fk
    foreign key (family_id, actor_member_id)
    references public.family_members(family_id, id)
    on delete set null (actor_member_id),
  constraint activity_logs_task_fk
    foreign key (family_id, task_id)
    references public.tasks(family_id, id)
    on delete set null (task_id)
);

create table public.storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade,
  bucket_id text not null check (bucket_id in ('reference-videos', 'voice-recordings')),
  object_path text not null check (object_path !~ '(^|/)\.\.(/|$)'),
  reason varchar(80) not null check (char_length(btrim(reason)) between 1 and 80),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error varchar(500),
  created_at timestamptz not null default now(),
  constraint storage_cleanup_queue_object_key unique (bucket_id, object_path)
);

create index family_members_family_idx on public.family_members(family_id);
create index member_sessions_active_token_idx
  on public.member_sessions(token_hash, expires_at)
  where revoked_at is null;
create index task_requests_family_created_idx on public.task_requests(family_id, created_at desc);
create index tasks_family_due_idx on public.tasks(family_id, due_at) where status in ('pending', 'in_progress', 'affected');
create index tasks_assignee_due_idx on public.tasks(assignee_member_id, due_at) where status in ('pending', 'in_progress', 'affected');
create index subtasks_task_idx on public.subtasks(task_id, position);
create index knowledge_entries_keywords_idx on public.knowledge_entries using gin(keywords);
create index task_knowledge_notes_task_idx on public.task_knowledge_notes(task_id, position);
create index voice_recordings_expiry_idx on public.voice_recordings(expires_at) where deleted_at is null;
create index reference_attachments_expiry_idx on public.reference_attachments(expires_at) where deleted_at is null;
create index completion_events_actor_time_idx on public.completion_events(actor_member_id, occurred_at desc);
create index completion_events_task_time_idx on public.completion_events(task_id, occurred_at desc);
create index activity_logs_family_time_idx on public.activity_logs(family_id, created_at desc);
create index storage_cleanup_queue_pending_idx
  on public.storage_cleanup_queue(next_attempt_at)
  where completed_at is null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger families_set_updated_at
before update on public.families
for each row execute function public.set_updated_at();

create trigger family_members_set_updated_at
before update on public.family_members
for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create trigger subtasks_set_updated_at
before update on public.subtasks
for each row execute function public.set_updated_at();

create trigger knowledge_entries_set_updated_at
before update on public.knowledge_entries
for each row execute function public.set_updated_at();

create trigger reference_attachments_set_updated_at
before update on public.reference_attachments
for each row execute function public.set_updated_at();

create or replace function public.enforce_family_member_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.family_id::text, 0));
  if (select count(*) from public.family_members where family_id = new.family_id) >= 8 then
    raise exception using errcode = 'P0001', message = 'FAMILY_MEMBER_LIMIT';
  end if;
  return new;
end;
$$;

create trigger family_members_limit_before_insert
before insert on public.family_members
for each row execute function public.enforce_family_member_limit();

create or replace function public.validate_family_creator()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.creator_member_id is not null and not exists (
    select 1
    from public.family_members m
    where m.id = new.creator_member_id
      and m.family_id = new.id
  ) then
    raise exception using errcode = 'P0001', message = 'CREATOR_NOT_IN_FAMILY';
  end if;
  return new;
end;
$$;

create trigger families_validate_creator
before insert or update of creator_member_id on public.families
for each row execute function public.validate_family_creator();

create or replace function public.complete_task(
  p_family_id uuid,
  p_task_id uuid,
  p_actor_member_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_completion_source public.completion_source,
  p_substitute_reason text default null
)
returns table (
  out_task_id uuid,
  task_version integer,
  event_id uuid,
  task_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_existing_event public.completion_events%rowtype;
  v_event_id uuid;
  v_new_version integer;
begin
  select e.*
  into v_existing_event
  from public.completion_events e
  where e.family_id = p_family_id
    and e.idempotency_key = p_idempotency_key;

  if found then
    return query
    select
      v_existing_event.task_id,
      v_existing_event.task_version,
      v_existing_event.id,
      t.status::text
    from public.tasks t
    where t.id = v_existing_event.task_id
      and t.family_id = p_family_id;
    return;
  end if;

  select t.*
  into v_task
  from public.tasks t
  where t.id = p_task_id
    and t.family_id = p_family_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'TASK_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.family_members m
    where m.id = p_actor_member_id
      and m.family_id = p_family_id
  ) then
    raise exception using errcode = 'P0001', message = 'ACTOR_NOT_IN_FAMILY';
  end if;

  if v_task.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'VERSION_CONFLICT';
  end if;

  if v_task.status = 'completed' then
    raise exception using errcode = 'P0001', message = 'TASK_ALREADY_COMPLETED';
  end if;

  update public.tasks
  set
    status = 'completed',
    completed_at = now(),
    version = version + 1
  where id = p_task_id
    and family_id = p_family_id
  returning version into v_new_version;

  insert into public.completion_events (
    family_id,
    task_id,
    assignee_member_id,
    actor_member_id,
    event_type,
    completion_source,
    substitute_reason,
    task_version,
    idempotency_key
  )
  values (
    p_family_id,
    p_task_id,
    v_task.assignee_member_id,
    p_actor_member_id,
    'completed',
    p_completion_source,
    p_substitute_reason,
    v_new_version,
    p_idempotency_key
  )
  returning id into v_event_id;

  insert into public.activity_logs (
    family_id,
    actor_member_id,
    task_id,
    activity_type,
    before_state,
    after_state,
    undo_expires_at
  )
  values (
    p_family_id,
    p_actor_member_id,
    p_task_id,
    'task_completed',
    jsonb_build_object('status', v_task.status::text, 'version', v_task.version),
    jsonb_build_object('status', 'completed', 'version', v_new_version),
    now() + interval '5 seconds'
  );

  return query select p_task_id, v_new_version, v_event_id, 'completed'::text;
end;
$$;

create or replace function public.undo_task_completion(
  p_family_id uuid,
  p_task_id uuid,
  p_actor_member_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_reverts_event_id uuid
)
returns table (
  out_task_id uuid,
  task_version integer,
  event_id uuid,
  task_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_target public.completion_events%rowtype;
  v_existing_event public.completion_events%rowtype;
  v_event_id uuid;
  v_new_version integer;
begin
  select e.*
  into v_existing_event
  from public.completion_events e
  where e.family_id = p_family_id
    and e.idempotency_key = p_idempotency_key;

  if found then
    return query
    select
      v_existing_event.task_id,
      v_existing_event.task_version,
      v_existing_event.id,
      t.status::text
    from public.tasks t
    where t.id = v_existing_event.task_id
      and t.family_id = p_family_id;
    return;
  end if;

  select t.*
  into v_task
  from public.tasks t
  where t.id = p_task_id
    and t.family_id = p_family_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'TASK_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.family_members m
    where m.id = p_actor_member_id
      and m.family_id = p_family_id
  ) then
    raise exception using errcode = 'P0001', message = 'ACTOR_NOT_IN_FAMILY';
  end if;

  if v_task.status <> 'completed' then
    raise exception using errcode = 'P0001', message = 'TASK_NOT_COMPLETED';
  end if;

  if v_task.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'VERSION_CONFLICT';
  end if;

  select e.*
  into v_target
  from public.completion_events e
  where e.id = p_reverts_event_id
    and e.family_id = p_family_id
    and e.task_id = p_task_id
    and e.event_type = 'completed';

  if not found then
    raise exception using errcode = 'P0001', message = 'COMPLETION_EVENT_NOT_FOUND';
  end if;

  if v_target.occurred_at < now() - interval '5 seconds' then
    raise exception using errcode = 'P0001', message = 'UNDO_WINDOW_EXPIRED';
  end if;

  if exists (
    select 1
    from public.completion_events e
    where e.reverts_event_id = p_reverts_event_id
  ) then
    raise exception using errcode = 'P0001', message = 'COMPLETION_ALREADY_UNDONE';
  end if;

  update public.tasks
  set
    status = 'pending',
    completed_at = null,
    version = version + 1
  where id = p_task_id
    and family_id = p_family_id
  returning version into v_new_version;

  insert into public.completion_events (
    family_id,
    task_id,
    assignee_member_id,
    actor_member_id,
    event_type,
    occurred_at,
    task_version,
    idempotency_key,
    reverts_event_id
  )
  values (
    p_family_id,
    p_task_id,
    v_task.assignee_member_id,
    p_actor_member_id,
    'undo',
    now(),
    v_new_version,
    p_idempotency_key,
    p_reverts_event_id
  )
  returning id into v_event_id;

  insert into public.activity_logs (
    family_id,
    actor_member_id,
    task_id,
    activity_type,
    before_state,
    after_state
  )
  values (
    p_family_id,
    p_actor_member_id,
    p_task_id,
    'task_undone',
    jsonb_build_object('status', v_task.status::text, 'version', v_task.version),
    jsonb_build_object('status', 'pending', 'version', v_new_version)
  );

  return query select p_task_id, v_new_version, v_event_id, 'pending'::text;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'families', 'family_members', 'member_sessions', 'task_requests', 'tasks',
    'subtasks', 'knowledge_entries', 'task_knowledge_notes', 'voice_recordings',
    'reference_attachments', 'completion_events', 'achievements', 'activity_logs',
    'storage_cleanup_queue'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_family_member_limit() from public, anon, authenticated;
revoke execute on function public.validate_family_creator() from public, anon, authenticated;
revoke execute on function public.complete_task(uuid, uuid, uuid, integer, text, public.completion_source, text)
  from public, anon, authenticated;
revoke execute on function public.undo_task_completion(uuid, uuid, uuid, integer, text, uuid)
  from public, anon, authenticated;

grant execute on function public.complete_task(uuid, uuid, uuid, integer, text, public.completion_source, text)
  to service_role;
grant execute on function public.undo_task_completion(uuid, uuid, uuid, integer, text, uuid)
  to service_role;

commit;
