# Supabase 数据库与文件存储

本目录实现 PRD v1.1 的服务端存储层。Supabase 只承担 PostgreSQL 和私有 Storage；成员登录继续使用 Express 的家庭邀请、4 位 PIN 和服务端会话。

## 文件

- `migrations/202607220001_family_collaboration_schema.sql`：业务表、枚举、约束、索引、RLS、触发器，以及完成/撤销任务的原子函数。
- `migrations/202607220002_private_storage_buckets.sql`：`reference-videos` 和 `voice-recordings` 私有 Bucket。
- `tests/database/family_collaboration_schema.test.sql`：35 项 pgTAP 验收测试。

## 执行方式

### Supabase Dashboard

在项目的 SQL Editor 中按文件名顺序执行两个 migration。启用 `pgTAP` 扩展后，可再执行测试文件；测试位于事务中，结束时会回滚测试数据。

### Supabase CLI

```bash
cd app
supabase init
supabase link --project-ref <project-ref>
supabase db push
supabase test db --linked
```

预期测试结果：`Files=1, Tests=35`，并以 `Result: PASS` 结束。

## 服务端环境变量

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only-secret>
```

`SUPABASE_SERVICE_ROLE_KEY` 只能由 Express 读取，禁止使用 `VITE_` 前缀、禁止提交 Git、禁止返回浏览器。前端继续通过 Express API 访问任务和附件。

## 数据安全

- 所有业务表都启用 RLS，并撤销 `anon`、`authenticated` 的表权限。
- 两个 Bucket 都是私有 Bucket，migration 不创建浏览器可用的 `storage.objects` policy。
- Express 校验自定义家庭会话后，才可使用 service role 访问数据或创建短期签名 URL。
- 会话只保存 token 的 SHA-256 哈希；成员 PIN 只保存带盐的 scrypt 哈希。
- 完成和撤销通过数据库函数执行，任务版本更新和事件写入处于同一事务。

## 应用字段映射

| TypeScript Schema | PostgreSQL |
|---|---|
| `family_id` / `member_id` / `task_id` | 各表 `id` |
| `subtask.order` | `subtasks.position` |
| `knowledge_notes[]` | `task_knowledge_notes` 按 `position` 聚合 |
| `reference_video_attachment` | `reference_attachments` |
| `completion_event.idempotency_key` | `completion_events(family_id, idempotency_key)` 唯一约束 |
| `task.version` | `tasks.version` |

## 文件路径

- 参考视频：`<familyId>/<taskId>/<attachmentId>.<ext>`
- 语音录音：`<familyId>/<requestId>/<recordingId>.<ext>`

对象名称必须由服务端生成，不得直接使用用户文件名。数据库只保存对象路径和经过清洗的展示文件名。
