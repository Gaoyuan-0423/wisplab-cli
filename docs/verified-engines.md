# 已验证引擎 / Verified engines

普通 `doctor` 区分依赖可用性 `ready` 与代码版本验证 `verified`。每个引擎报告当前及期望修订号、`matchesLock` 和脏状态；依赖可用且三个引擎均为干净的锁定修订时，整体 `verified` 才为 true。`doctor --strict` 在未验证时返回非零退出码。此检查不代替数值基准，也不检查被 Git 忽略的依赖内容。

Regular `doctor` separates dependency readiness from revision verification. `doctor --strict` requires installed dependencies and all three clean, exact revisions from `engines.lock.json`. This does not independently validate numerical accuracy or fingerprint ignored dependency contents.

```sh
node scripts/setup-engines.mjs --root ./verified-engines --config ./verified.config.json --plan
node scripts/setup-engines.mjs --root ./verified-engines --config ./verified.config.json
node cli.mjs doctor --config ./verified.config.json --strict
```

安装器克隆到全新目录，检出锁定修订，运行各仓库 `npm ci` 并安装对应 Chromium；不会更新已有仓库或覆盖配置。父目录应存在；现有目标目录会被拒绝。安装需要网络；失败后保留部分目录用于排查，重试使用新目录。Linux 如缺浏览器系统依赖，按 Playwright 提示安装后再检查。数据目录按需添加到生成配置的 `allowPaths`。

The installer clones new repositories, checks out exact commits, installs locked dependencies and Chromium, then writes a new config. Existing destinations/configs are refused. The parent directory must exist. Network access is required; partial directories remain on failure for inspection. Choose a new destination when retrying. Install any platform dependencies requested by Playwright and add your data directories to `allowPaths` as needed.
