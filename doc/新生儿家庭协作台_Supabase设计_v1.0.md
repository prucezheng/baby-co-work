# 新生儿家庭协作台 Supabase 存储设计 v1.0

> 日期：2026-07-22
> 决策状态：已认可
> 需求基线：`新生儿家庭协作台_PRD_v1.1.md`

## 1. 架构决策

Supabase 只替换数据库和文件存储，不使用 Supabase Auth：

- PostgreSQL 保存家庭、成员、会话、任务、事件、贡献来源和成就。
- Supabase Storage 保存语音临时文件和任务参考视频。
- Express 保留业务 API、AI 编排、4 位 PIN 校验和家庭会话。
- React 前端不直接访问 Supabase。
- Hackathon 阶段不启用 Realtime；页面操作后刷新，前台每 10 秒刷新，恢复前台时立即刷新。

## 2. 安全边界

- `service_role` 密钥只存在于 Express 环境变量。
- 所有业务表启用 RLS，并撤销浏览器角色的直接权限。
- Storage Bucket 保持私有，Express 按家庭身份生成短期签名 URL。
- PIN 和 session token 均不以明文保存。
- 数据库函数只授权 `service_role` 执行。

## 3. 一致性

- 任务使用 `version` 实现乐观锁。
- 请求和完成事件使用家庭范围内的幂等键。
- 完成/撤销在数据库事务中同步更新任务和追加不可变事件。
- 子步骤最多 6 个，家庭成员最多 8 人，父任务最多一个参考视频。
- 贡献和成就从完成事件派生，不保存不可追溯积分。

## 4. 文件生命周期

- 参考视频存放于 `reference-videos` 私有 Bucket，默认 24 小时过期。
- 语音存放于 `voice-recordings` 私有 Bucket，转写成功后可立即删除，最晚 24 小时清理。
- Storage 删除失败写入 `storage_cleanup_queue`，由服务端定期重试。
- 数据库备份不代替 Storage 对象备份；Hackathon MVP 接受视频过期后只保留附件失效状态。

## 5. 不包含范围

- Supabase Auth、邮箱/手机登录和 OAuth。
- 浏览器直接查询数据库或直接上传私有 Bucket。
- Realtime、向量检索、视频转码和长期媒体归档。
