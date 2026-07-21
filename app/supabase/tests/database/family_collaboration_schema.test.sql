begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

select has_table('public', 'families', 'families table exists');
select has_table('public', 'family_members', 'family_members table exists');
select has_table('public', 'member_sessions', 'member_sessions table exists');
select has_table('public', 'task_requests', 'task_requests table exists');
select has_table('public', 'tasks', 'tasks table exists');
select has_table('public', 'subtasks', 'subtasks table exists');
select has_table('public', 'knowledge_entries', 'knowledge_entries table exists');
select has_table('public', 'task_knowledge_notes', 'task_knowledge_notes table exists');
select has_table('public', 'voice_recordings', 'voice_recordings table exists');
select has_table('public', 'reference_attachments', 'reference_attachments table exists');
select has_table('public', 'completion_events', 'completion_events table exists');
select has_table('public', 'achievements', 'achievements table exists');
select has_table('public', 'activity_logs', 'activity_logs table exists');
select has_table('public', 'storage_cleanup_queue', 'storage_cleanup_queue table exists');

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'families', 'family_members', 'member_sessions', 'task_requests', 'tasks',
        'subtasks', 'knowledge_entries', 'task_knowledge_notes', 'voice_recordings',
        'reference_attachments', 'completion_events', 'achievements', 'activity_logs',
        'storage_cleanup_queue'
      ])
  ),
  'RLS is enabled on every application table'
);

select has_index(
  'public',
  'task_requests',
  'task_requests_family_request_key',
  'task request idempotency index exists'
);
select has_index(
  'public',
  'completion_events',
  'completion_events_family_idempotency_key',
  'completion event idempotency index exists'
);
select has_index(
  'public',
  'reference_attachments',
  'reference_attachments_task_key',
  'one reference video per parent task is enforced'
);
select has_index(
  'public',
  'subtasks',
  'subtasks_task_position_key',
  'subtask positions are unique within a task'
);
select has_index(
  'public',
  'achievements',
  'achievements_owner_code_key',
  'achievement unlocks are idempotent'
);

select is(
  (
    select count(*)::integer
    from storage.buckets
    where id in ('reference-videos', 'voice-recordings')
  ),
  2,
  'both private file buckets exist'
);
select ok(
  not exists(
    select 1
    from storage.buckets
    where id in ('reference-videos', 'voice-recordings')
      and public
  ),
  'both file buckets are private'
);

insert into public.families (id, display_name, invite_token_hash)
values ('10000000-0000-0000-0000-000000000001', '测试家庭', repeat('a', 64));

insert into public.family_members (
  id,
  family_id,
  display_name,
  role,
  pin_hash,
  identity_claimed
)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '爸爸',
  '爸爸',
  'scrypt$test-salt$test-hash',
  true
);

update public.families
set creator_member_id = '20000000-0000-0000-0000-000000000001'
where id = '10000000-0000-0000-0000-000000000001';

insert into public.tasks (
  id,
  family_id,
  created_by_member_id,
  title,
  raw_input,
  input_type,
  assignee_member_id,
  due_at,
  duration_min,
  completion_criteria,
  assignment_reason
)
values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '准备睡前用品',
  '爸爸今晚八点前准备好宝宝睡前用品',
  'text',
  '20000000-0000-0000-0000-000000000001',
  now() + interval '2 hours',
  10,
  '用品放到护理台旁边',
  '原始输入明确点名爸爸'
);

select pass('family, member and task fixtures satisfy all constraints');

select lives_ok(
  $$select * from public.complete_task(
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    1,
    'complete-test-task-v1',
    'self',
    null
  )$$,
  'complete_task atomically completes a task'
);
select is(
  (select status::text from public.tasks where id = '30000000-0000-0000-0000-000000000001'),
  'completed',
  'complete_task changes task status'
);
select is(
  (
    select actor_member_id
    from public.completion_events
    where idempotency_key = 'complete-test-task-v1'
  ),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'completion event records the actual actor'
);
select lives_ok(
  $$select * from public.complete_task(
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    1,
    'complete-test-task-v1',
    'self',
    null
  )$$,
  'repeating the same idempotency key returns safely'
);
select is(
  (
    select count(*)::integer
    from public.completion_events
    where idempotency_key = 'complete-test-task-v1'
  ),
  1,
  'idempotent completion writes one event'
);
select throws_ok(
  $$select * from public.complete_task(
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    1,
    'different-key-with-stale-version',
    'self',
    null
  )$$,
  'P0001',
  'VERSION_CONFLICT',
  'stale task versions are rejected'
);
select lives_ok(
  $$select * from public.undo_task_completion(
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    2,
    'undo-test-task-v2',
    (select id from public.completion_events where idempotency_key = 'complete-test-task-v1')
  )$$,
  'undo_task_completion records an undo inside the five-second window'
);
select is(
  (select status::text from public.tasks where id = '30000000-0000-0000-0000-000000000001'),
  'pending',
  'undo returns the task to pending'
);
select is(
  (
    select count(*)::integer
    from public.completion_events
    where event_type = 'undo'
      and idempotency_key = 'undo-test-task-v2'
  ),
  1,
  'undo is retained as an immutable event'
);
select throws_ok(
  $$insert into public.completion_events (
    family_id, task_id, assignee_member_id, actor_member_id, event_type,
    completion_source, occurred_at, task_version, idempotency_key
  ) values (
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'completed', 'substitute', now(), 3, 'invalid-substitute'
  )$$,
  '23514',
  null,
  'substitute completion requires a reason'
);

insert into public.family_members (
  family_id, display_name, role, pin_hash, identity_claimed
)
select
  '10000000-0000-0000-0000-000000000001',
  '成员' || number,
  '其他',
  'scrypt$test-salt$test-hash',
  false
from generate_series(2, 8) as number;

select throws_ok(
  $$insert into public.family_members (
    family_id, display_name, role, pin_hash, identity_claimed
  ) values (
    '10000000-0000-0000-0000-000000000001',
    '第九位成员',
    '其他',
    'scrypt$test-salt$test-hash',
    false
  )$$,
  'P0001',
  'FAMILY_MEMBER_LIMIT',
  'a family cannot contain more than eight members'
);

insert into public.subtasks (task_id, family_id, title, position, required, source)
select
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '步骤' || number,
  number,
  true,
  'ai'
from generate_series(1, 6) as number;

select throws_ok(
  $$insert into public.subtasks (
    task_id, family_id, title, position, required, source
  ) values (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '第七步',
    7,
    true,
    'ai'
  )$$,
  '23514',
  null,
  'a parent task cannot contain a seventh position'
);

select * from finish();
rollback;
