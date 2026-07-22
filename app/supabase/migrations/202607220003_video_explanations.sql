begin;

create type public.reference_analysis_status as enum (
  'uploaded',
  'transcribing',
  'analyzing',
  'ready',
  'failed'
);

alter table public.reference_attachments
  add column analysis_status public.reference_analysis_status not null default 'uploaded',
  add column analysis_attempts smallint not null default 0,
  add column analysis_error_code varchar(80),
  add column analysis_started_at timestamptz,
  add column analyzed_at timestamptz,
  add constraint reference_attachments_analysis_attempts_check
    check (analysis_attempts between 0 and 2),
  add constraint reference_attachments_analysis_error_code_check
    check (
      analysis_error_code is null
      or analysis_error_code ~ '^[A-Z0-9_]{1,80}$'
    ),
  add constraint reference_attachments_analysis_state_check
    check (
      (
        analysis_status = 'uploaded'
        and analysis_attempts between 0 and 1
        and analysis_started_at is null
        and analyzed_at is null
        and analysis_error_code is null
      )
      or
      (
        analysis_status in ('transcribing', 'analyzing')
        and analysis_attempts between 1 and 2
        and analysis_started_at is not null
        and analyzed_at is null
        and analysis_error_code is null
      )
      or
      (
        analysis_status = 'ready'
        and analysis_attempts between 1 and 2
        and analysis_started_at is not null
        and analyzed_at is not null
        and analysis_error_code is null
      )
      or
      (
        analysis_status = 'failed'
        and analysis_attempts = 2
        and analysis_started_at is not null
        and analyzed_at is null
        and analysis_error_code is not null
      )
    ),
  add constraint reference_attachments_family_id_id_key unique (family_id, id);

create table public.video_explanations (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null,
  family_id uuid not null,
  position smallint not null check (position between 1 and 6),
  title varchar(50) not null check (char_length(btrim(title)) between 1 and 50),
  explanation varchar(300) not null check (char_length(btrim(explanation)) between 1 and 300),
  start_sec integer,
  end_sec integer,
  model_name varchar(120) not null check (char_length(btrim(model_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  constraint video_explanations_attachment_fk
    foreign key (family_id, attachment_id)
    references public.reference_attachments(family_id, id)
    on delete cascade,
  constraint video_explanations_attachment_position_key unique (attachment_id, position),
  constraint video_explanations_time_range_check check (
    (start_sec is null and end_sec is null)
    or
    (
      start_sec is not null
      and end_sec is not null
      and start_sec >= 0
      and end_sec >= start_sec
    )
  )
);

create index reference_attachments_analysis_queue_idx
  on public.reference_attachments(analysis_status, updated_at)
  where deleted_at is null
    and status = 'ready'
    and analysis_status = 'uploaded'
    and analysis_attempts < 2;

create or replace function public.start_video_analysis(
  p_family_id uuid,
  p_attachment_id uuid
)
returns table (
  analysis_attempt smallint,
  out_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attachment public.reference_attachments%rowtype;
begin
  select a.*
  into v_attachment
  from public.reference_attachments a
  where a.id = p_attachment_id
    and a.family_id = p_family_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'REFERENCE_ATTACHMENT_NOT_FOUND';
  end if;

  if v_attachment.analysis_attempts >= 2 then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_ATTEMPT_LIMIT';
  end if;

  if v_attachment.deleted_at is not null
    or v_attachment.expires_at <= now()
    or v_attachment.status <> 'ready'
  then
    raise exception using errcode = 'P0001', message = 'REFERENCE_ATTACHMENT_NOT_READY';
  end if;

  if v_attachment.analysis_status <> 'uploaded' then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_STATE_CONFLICT';
  end if;

  update public.reference_attachments
  set
    analysis_attempts = analysis_attempts + 1,
    analysis_status = 'transcribing',
    analysis_error_code = null,
    analysis_started_at = now(),
    analyzed_at = null
  where id = p_attachment_id
    and family_id = p_family_id
  returning
    analysis_attempts,
    analysis_status::text
  into analysis_attempt, out_status;

  return next;
end;
$$;

create or replace function public.advance_video_analysis(
  p_family_id uuid,
  p_attachment_id uuid,
  p_expected_attempt smallint
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attachment public.reference_attachments%rowtype;
  v_status text;
begin
  select a.*
  into v_attachment
  from public.reference_attachments a
  where a.id = p_attachment_id
    and a.family_id = p_family_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'REFERENCE_ATTACHMENT_NOT_FOUND';
  end if;

  if v_attachment.analysis_attempts <> p_expected_attempt then
    raise exception using errcode = 'P0001', message = 'STALE_ANALYSIS_ATTEMPT';
  end if;

  if v_attachment.analysis_status <> 'transcribing' then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_STATE_CONFLICT';
  end if;

  update public.reference_attachments
  set analysis_status = 'analyzing'
  where id = p_attachment_id
    and family_id = p_family_id
  returning analysis_status::text into v_status;

  return v_status;
end;
$$;

create or replace function public.publish_video_explanations(
  p_family_id uuid,
  p_attachment_id uuid,
  p_expected_attempt smallint,
  p_model_name text,
  p_explanations jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attachment public.reference_attachments%rowtype;
  v_count integer;
  v_item jsonb;
  v_ordinality integer;
  v_start_text text;
  v_end_text text;
begin
  select a.*
  into v_attachment
  from public.reference_attachments a
  where a.id = p_attachment_id
    and a.family_id = p_family_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'REFERENCE_ATTACHMENT_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.video_explanations e
    where e.attachment_id = p_attachment_id
      and e.family_id = p_family_id
  ) then
    raise exception using errcode = 'P0001', message = 'EXPLANATIONS_ALREADY_PUBLISHED';
  end if;

  if v_attachment.analysis_attempts <> p_expected_attempt then
    raise exception using errcode = 'P0001', message = 'STALE_ANALYSIS_ATTEMPT';
  end if;

  if v_attachment.analysis_status <> 'analyzing' then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_STATE_CONFLICT';
  end if;

  if p_model_name is null
    or char_length(btrim(p_model_name)) not between 1 and 120
  then
    raise exception using errcode = 'P0001', message = 'MODEL_NAME_INVALID';
  end if;

  if p_explanations is null or jsonb_typeof(p_explanations) <> 'array' then
    raise exception using errcode = 'P0001', message = 'EXPLANATIONS_INVALID';
  end if;

  v_count := jsonb_array_length(p_explanations);
  if v_count not between 2 and 6 then
    raise exception using errcode = 'P0001', message = 'EXPLANATION_COUNT_INVALID';
  end if;

  for v_item, v_ordinality in
    select item.value, item.ordinality::integer
    from jsonb_array_elements(p_explanations) with ordinality as item(value, ordinality)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = 'P0001', message = 'EXPLANATION_ITEM_INVALID';
    end if;

    if v_item ->> 'title' is null
      or v_item ->> 'explanation' is null
      or char_length(btrim(v_item ->> 'title')) not between 1 and 50
      or char_length(btrim(v_item ->> 'explanation')) not between 1 and 300
    then
      raise exception using errcode = 'P0001', message = 'EXPLANATION_TEXT_INVALID';
    end if;

    v_start_text := v_item ->> 'start_sec';
    v_end_text := v_item ->> 'end_sec';

    if (v_start_text is null) <> (v_end_text is null) then
      raise exception using errcode = 'P0001', message = 'EXPLANATION_TIME_RANGE_INVALID';
    end if;

    if v_start_text is not null then
      if v_start_text !~ '^[0-9]{1,9}$'
        or v_end_text !~ '^[0-9]{1,9}$'
        or v_end_text::integer < v_start_text::integer
      then
        raise exception using errcode = 'P0001', message = 'EXPLANATION_TIME_RANGE_INVALID';
      end if;
    end if;

    insert into public.video_explanations (
      attachment_id,
      family_id,
      position,
      title,
      explanation,
      start_sec,
      end_sec,
      model_name
    )
    values (
      p_attachment_id,
      p_family_id,
      v_ordinality,
      btrim(v_item ->> 'title'),
      btrim(v_item ->> 'explanation'),
      v_start_text::integer,
      v_end_text::integer,
      btrim(p_model_name)
    );
  end loop;

  update public.reference_attachments
  set
    analysis_status = 'ready',
    analysis_error_code = null,
    analyzed_at = now()
  where id = p_attachment_id
    and family_id = p_family_id;

  return v_count;
end;
$$;

create or replace function public.record_video_analysis_failure(
  p_family_id uuid,
  p_attachment_id uuid,
  p_expected_attempt smallint,
  p_error_code text
)
returns table (
  out_status text,
  will_retry boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attachment public.reference_attachments%rowtype;
  v_safe_error_code text;
begin
  select a.*
  into v_attachment
  from public.reference_attachments a
  where a.id = p_attachment_id
    and a.family_id = p_family_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'REFERENCE_ATTACHMENT_NOT_FOUND';
  end if;

  if v_attachment.analysis_attempts <> p_expected_attempt then
    raise exception using errcode = 'P0001', message = 'STALE_ANALYSIS_ATTEMPT';
  end if;

  if v_attachment.analysis_status not in ('transcribing', 'analyzing') then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_STATE_CONFLICT';
  end if;

  v_safe_error_code := upper(btrim(p_error_code));
  if v_safe_error_code is null
    or v_safe_error_code !~ '^[A-Z0-9_]{1,80}$'
  then
    raise exception using errcode = 'P0001', message = 'ANALYSIS_ERROR_CODE_INVALID';
  end if;

  if v_attachment.analysis_attempts < 2 then
    update public.reference_attachments
    set
      analysis_status = 'uploaded',
      analysis_error_code = null,
      analysis_started_at = null,
      analyzed_at = null
    where id = p_attachment_id
      and family_id = p_family_id;

    out_status := 'uploaded';
    will_retry := true;
  else
    update public.reference_attachments
    set
      analysis_status = 'failed',
      analysis_error_code = v_safe_error_code,
      analyzed_at = null
    where id = p_attachment_id
      and family_id = p_family_id;

    out_status := 'failed';
    will_retry := false;
  end if;

  return next;
end;
$$;

alter table public.video_explanations enable row level security;

revoke all on table public.video_explanations from public, anon, authenticated, service_role;
grant select on table public.video_explanations to service_role;

revoke usage on type public.reference_analysis_status from public, anon, authenticated;
grant usage on type public.reference_analysis_status to service_role;

revoke execute on function public.start_video_analysis(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.advance_video_analysis(uuid, uuid, smallint)
  from public, anon, authenticated;
revoke execute on function public.publish_video_explanations(uuid, uuid, smallint, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.record_video_analysis_failure(uuid, uuid, smallint, text)
  from public, anon, authenticated;

grant execute on function public.start_video_analysis(uuid, uuid)
  to service_role;
grant execute on function public.advance_video_analysis(uuid, uuid, smallint)
  to service_role;
grant execute on function public.publish_video_explanations(uuid, uuid, smallint, text, jsonb)
  to service_role;
grant execute on function public.record_video_analysis_failure(uuid, uuid, smallint, text)
  to service_role;

commit;
