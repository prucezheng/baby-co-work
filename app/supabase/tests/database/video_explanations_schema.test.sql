begin;

create extension if not exists pgtap with schema extensions;

select plan(39);

select has_type(
  'public',
  'reference_analysis_status',
  'reference video analysis status type exists'
);
select has_column('public', 'reference_attachments', 'analysis_status', 'analysis status is stored');
select has_column('public', 'reference_attachments', 'analysis_attempts', 'analysis attempts are stored');
select has_column('public', 'reference_attachments', 'analysis_error_code', 'safe analysis error code is stored');
select has_column('public', 'reference_attachments', 'analysis_started_at', 'analysis start time is stored');
select has_column('public', 'reference_attachments', 'analyzed_at', 'analysis completion time is stored');
select has_table('public', 'video_explanations', 'video explanations table exists');
select hasnt_column(
  'public',
  'video_explanations',
  'transcript',
  'raw ASR transcript is not stored in video explanations'
);
select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'video_explanations'
  ),
  'RLS is enabled on video explanations'
);
select has_index(
  'public',
  'reference_attachments',
  'reference_attachments_family_id_id_key',
  'reference attachments support family-scoped foreign keys'
);
select has_index(
  'public',
  'video_explanations',
  'video_explanations_attachment_position_key',
  'video explanation positions are unique per attachment'
);
select has_index(
  'public',
  'reference_attachments',
  'reference_attachments_analysis_queue_idx',
  'pending video analyses can be dequeued efficiently'
);
select ok(
  to_regprocedure('public.start_video_analysis(uuid,uuid)') is not null,
  'start_video_analysis function exists'
);
select ok(
  to_regprocedure('public.advance_video_analysis(uuid,uuid,smallint)') is not null,
  'advance_video_analysis function exists'
);
select ok(
  to_regprocedure('public.publish_video_explanations(uuid,uuid,smallint,text,jsonb)') is not null,
  'publish_video_explanations function exists'
);
select ok(
  to_regprocedure('public.record_video_analysis_failure(uuid,uuid,smallint,text)') is not null,
  'record_video_analysis_failure function exists'
);
select ok(
  not has_table_privilege('service_role', 'public.video_explanations', 'UPDATE'),
  'service role cannot edit published explanations'
);
select ok(
  not has_table_privilege('service_role', 'public.video_explanations', 'INSERT'),
  'service role can publish explanations only through the validated function'
);

insert into public.families (id, display_name, invite_token_hash)
values (
  '91000000-0000-0000-0000-000000000001',
  'Video Test Family',
  repeat('9', 64)
);

insert into public.family_members (
  id,
  family_id,
  display_name,
  role,
  pin_hash,
  identity_claimed
)
values (
  '92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  'Parent',
  'parent',
  'scrypt$video-test-salt$video-test-hash',
  true
);

update public.families
set creator_member_id = '92000000-0000-0000-0000-000000000001'
where id = '91000000-0000-0000-0000-000000000001';

insert into public.tasks (
  id,
  family_id,
  created_by_member_id,
  title,
  raw_input,
  input_type,
  assignee_member_id,
  duration_min,
  completion_criteria,
  assignment_reason
)
values
  (
    '93000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000001',
    'Reference video success',
    'Create a task with a reference video',
    'text',
    '92000000-0000-0000-0000-000000000001',
    10,
    'The parent task is completed by its assignee',
    'The test assigns the task to its creator'
  ),
  (
    '93000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000001',
    'Reference video failure',
    'Create another task to test automatic retry',
    'text',
    '92000000-0000-0000-0000-000000000001',
    10,
    'The failed analysis does not block task completion',
    'The test assigns the task to its creator'
  );

insert into public.reference_attachments (
  id,
  task_id,
  family_id,
  object_path,
  file_name,
  mime_type,
  file_size,
  status,
  expires_at
)
values
  (
    '94000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000001.mp4',
    'success.mp4',
    'mp4',
    1024,
    'ready',
    now() + interval '1 day'
  ),
  (
    '94000000-0000-0000-0000-000000000002',
    '93000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000002.mp4',
    'failure.mp4',
    'mp4',
    2048,
    'ready',
    now() + interval '1 day'
  );

select pass('video analysis fixtures satisfy all constraints');

select lives_ok(
  $$select * from public.start_video_analysis(
    '91000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000001'
  )$$,
  'a ready video can begin its first analysis attempt'
);
select is(
  (
    select analysis_attempts::integer
    from public.reference_attachments
    where id = '94000000-0000-0000-0000-000000000001'
  ),
  1,
  'starting analysis increments the attempt count'
);
select is(
  (
    select analysis_status::text
    from public.reference_attachments
    where id = '94000000-0000-0000-0000-000000000001'
  ),
  'transcribing',
  'analysis starts with audio transcription'
);
select lives_ok(
  $$select public.advance_video_analysis(
    '91000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000001',
    1::smallint
  )$$,
  'analysis advances from ASR to video understanding'
);
select throws_ok(
  $$select public.publish_video_explanations(
    '91000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000001',
    1::smallint,
    'doubao-seed-2-0-lite-260428',
    '[
      {
        "title": "Only one card",
        "explanation": "A video explanation must contain at least two cards."
      }
    ]'::jsonb
  )$$,
  'P0001',
  'EXPLANATION_COUNT_INVALID',
  'one explanation card is rejected'
);
select lives_ok(
  $$select public.publish_video_explanations(
    '91000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000001',
    1::smallint,
    'doubao-seed-2-0-lite-260428',
    '[
      {
        "title": "Support the neck",
        "explanation": "Use one hand to support the neck before lifting the baby.",
        "start_sec": 4,
        "end_sec": 12
      },
      {
        "title": "Keep movements steady",
        "explanation": "Move slowly and keep the baby close to your body."
      }
    ]'::jsonb
  )$$,
  'two explanatory cards can be published atomically'
);
select is(
  (
    select analysis_status::text
    from public.reference_attachments
    where id = '94000000-0000-0000-0000-000000000001'
  ),
  'ready',
  'successful publication marks analysis ready'
);
select is(
  (
    select count(*)::integer
    from public.video_explanations
    where attachment_id = '94000000-0000-0000-0000-000000000001'
  ),
  2,
  'exactly two explanation cards are retained'
);
select is(
  (
    select start_sec
    from public.video_explanations
    where attachment_id = '94000000-0000-0000-0000-000000000001'
      and position = 1
  ),
  4,
  'optional video timestamps are retained'
);
select throws_ok(
  $$select public.publish_video_explanations(
    '91000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000001',
    1::smallint,
    'doubao-seed-2-0-lite-260428',
    '[
      {"title": "Changed", "explanation": "Published explanations are immutable."},
      {"title": "Changed again", "explanation": "A second publication is rejected."}
    ]'::jsonb
  )$$,
  'P0001',
  'EXPLANATIONS_ALREADY_PUBLISHED',
  'published explanations cannot be replaced or regenerated'
);

select lives_ok(
  $$select * from public.start_video_analysis(
    '91000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000002'
  )$$,
  'the retry fixture begins its first attempt'
);
select lives_ok(
  $$select public.record_video_analysis_failure(
    '91000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000002',
    1::smallint,
    'ASR_TEMPORARY_FAILURE'
  )$$,
  'the first failure is recorded without surfacing raw provider errors'
);
select is(
  (
    select analysis_status::text
    from public.reference_attachments
    where id = '94000000-0000-0000-0000-000000000002'
  ),
  'uploaded',
  'the first failure returns the video to the automatic queue'
);
select is(
  (
    select analysis_attempts::integer
    from public.reference_attachments
    where id = '94000000-0000-0000-0000-000000000002'
  ),
  1,
  'the first failed attempt remains counted'
);
select lives_ok(
  $$select * from public.start_video_analysis(
    '91000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000002'
  )$$,
  'one automatic retry can begin'
);
select lives_ok(
  $$select public.record_video_analysis_failure(
    '91000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000002',
    2::smallint,
    'VIDEO_UNDERSTANDING_FAILED'
  )$$,
  'the second failure is recorded'
);
select is(
  (
    select analysis_status::text
    from public.reference_attachments
    where id = '94000000-0000-0000-0000-000000000002'
  ),
  'failed',
  'analysis stops after two failed attempts'
);
select is(
  (
    select analysis_error_code
    from public.reference_attachments
    where id = '94000000-0000-0000-0000-000000000002'
  ),
  'VIDEO_UNDERSTANDING_FAILED',
  'the final safe error code is retained'
);
select throws_ok(
  $$select * from public.start_video_analysis(
    '91000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000002'
  )$$,
  'P0001',
  'ANALYSIS_ATTEMPT_LIMIT',
  'a third analysis attempt is rejected'
);
select is(
  (
    select count(*)::integer
    from public.video_explanations
    where attachment_id = '94000000-0000-0000-0000-000000000002'
  ),
  0,
  'failed analysis creates no partial explanation cards'
);

select * from finish();
rollback;
