# Agent Note：SPPM 上游叠加架构

Status：已实现

[English](2026-09-21-sppm-upstream-overlay-architecture.md) | 中文

## 问题

SPPM 需要使用 DeepSeek Harness `dsh-v0.1.6-alpha.2` 的图片输入能力，同时继续接收官方后续版本和用户 fork 中的小型修复。原有仓库历史把一份完整 Harness 源码作为单个私有提交导入，因此 SPPM 提交与官方提交没有共同祖先，直接合并 upstream 会把整个仓库变成冲突区。

## 决策

以用户 fork 的 `master` 作为官方基线，在本地配置 `origin` 指向 `https://github.com/Laplace-bit/deepseek-harness.git`，配置 `upstream` 指向 `https://github.com/deepseek-ai/deepseek-harness.git`，并在 `sppm/v0.1.6-alpha.2` 分支上叠加 SPPM。旧的整体导入历史保留在 `legacy/sppm-agent-pre-upstream-migration` 分支中，作为回滚和取证来源，不再作为后续开发基线。

SPPM 功能只通过 Harness 已有扩展点接入：`packages/sppm/` 保存页面桥接、Harness plugin、浏览器嵌入和网关；`packages/sppm/profile/cordis.patch.yml` 作为固定 profile overlay，通过网关启动子进程时传给 `--patch`；网关负责用户认证、实例隔离、HTTP/WebSocket 代理和请求体上限。CLI manifest 显式声明 overlay 中引用的每个插件，确保干净的生产安装不依赖 pnpm 提升依赖。官方标准 preset、核心 Agent 循环和模型适配器保持原样，避免把 SPPM 的安全限制和业务语义写入官方可持续变化的文件。

图片输入的 503 修复属于网关边界配置：Harness API 请求体默认允许 300 MiB，并可通过 `SPPM_MAX_HARNESS_REQUEST_BODY_BYTES` 调整；控制面请求仍使用较小的固定限制，超限返回 413 而不伪装成 503。模型输入类型由 Harness `v0.1.6-alpha.2` 的原生设置界面和 `settings.yaml` 管理，视觉模型必须声明 `input: [text, image]` 或使用目录继承的图片能力。

## 更新流程

同步官方版本时，先将官方主干合入 fork 的 `master`，再在 SPPM 分支上重放本地提交：

```text
git fetch upstream --tags --prune
git switch master
git merge --no-ff upstream/master
git push origin master
git switch sppm/v0.1.6-alpha.2
git rebase origin/master
pnpm install --lockfile-only
pnpm run verify-cordis-config
pnpm run typecheck:sppm
```

如果官方 API 变化，优先修改 `packages/sppm/` 内的适配器或 profile overlay；只有当官方扩展点本身变化时，才调整根目录的源码路径映射、项目引用或启动脚本。每次升级后都要重新运行 SPPM 测试和浏览器 assistant bundle 构建。

## 考虑过的替代方案

**继续在旧私有历史上合并 upstream。** 这种方式没有共同祖先，会把官方全部文件标记为冲突，并且每次升级都重复解决历史导入冲突，维护成本不可接受。

**复制官方 release 到新的 SPPM 仓库。** 复制快照可以暂时工作，但无法表达 fork 的小修复与官方主干的共同历史，也不能让 Git 在升级时准确定位 SPPM 差异。

**直接修改官方标准 preset。** 这会让 SPPM 的工具禁用规则随着官方 preset 改名或重排而产生隐蔽漂移；固定 profile overlay 能把安全边界集中在 SPPM 代码中，并允许官方 preset 独立更新。

## 影响

当前基线可从 fork 的 alpha2 共同祖先继续同步官方版本，同时保留 fork 已有的滚动修复。`packages/sppm/` 是可单独类型检查和测试的边界，根目录只新增 SPPM 专用脚本、源码解析映射和显式 CLI 运行时依赖。旧分支保留原实现和运行数据之外的代码快照；`.data/` 仍是本地运行时目录，不应提交。

验证包括 `pnpm run verify-cordis-config`、`pnpm run typecheck:sppm`、39 个 SPPM 单元测试以及 `pnpm run bundle:sppm-assistant`。assistant bundle 构建中的 `import.meta`/Node external 提示来自现有 IIFE 打包链，不影响构建成功；后续可单独安排 bundler warning 清理。
