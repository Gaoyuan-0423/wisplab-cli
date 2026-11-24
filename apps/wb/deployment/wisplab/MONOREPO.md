# 单仓发布、预演与恢复

工作目录是 `wisplab-cli` 仓库根。当前 CI 构建官网总入口、WB、病理、PCR 和 BlotLens；独立 BlotLens 的 Node 服务与桌面安装包分别交付。现网切换需所有者在预演、恢复和用户项目导出验证完成后明确批准。

## 构建和证据

| 入口 | 发布来源或构建产物 |
| --- | --- |
| `wisplab.top` | 同一提交的 `apps/wb/deployment/wisplab/portal` |
| `wb.wisplab.top` | `web-dist-wb`，含 `blotlens/` 静态入口 |
| `pathology.wisplab.top`、`pcr.wisplab.top` | `web-dist-pathology`、`web-dist-pcr` |
| `blotlens.top` | `web-dist-blotlens` 与该轮构建的 `blotlens-linux` 服务包 |
| 桌面离线 | `desktop.yml` 取同一个单仓提交的三份 Web 产物和门户，WB 内含 BlotLens。安装包验证由 `desktop-release.yml` 独立触发 |

`apps.yml` 随 PR 在 macOS 和 Windows 运行桌面打包与离线 smoke。正式候选取同一 `main` SHA 的完整 `apps.yml`、`ci.yml` 成功记录。门户取 Git 对象。打包会复核 ZIP 摘要、逐文件哈希、Portal 与三站共享资源，以及独立和内嵌 BlotLens 的字节一致性。

## 本机离线预演

先在四个应用各自安装锁定依赖并构建。WB 构建会调用本仓的 BlotLens 源码。用 `npm --prefix apps/blotlens run package:release` 生成 Node 服务包。准备一个全新的临时目录，并指定旧站点实际生效的标签；独立 BlotLens 的历史服务包另存一份。下例的两个标签是 2026-11-24 预演采用的基线，下一次切换请先核对实际生效版本和 Pages 各应用的提交。

```sh
RUN_DIR=$(mktemp -d)
DEPLOY=apps/wb/deployment/wisplab
gh release download wisplab-deploy-20261025-apple-privacy --repo Gaoyuan-0423/blot-workbench --dir "$RUN_DIR/previous"
gh release download v0.2.1 --repo Gaoyuan-0423/blotlens --dir "$RUN_DIR/previous-service"
python3 "$DEPLOY/suite_release.py" verify "$RUN_DIR/previous"
python3 "$DEPLOY/suite_release.py" prepare-local --version rehearsal-1 --output "$RUN_DIR/candidate"
python3 "$DEPLOY/suite_release.py" rehearse --previous "$RUN_DIR/previous" --previous-service "$RUN_DIR/previous-service" --candidate "$RUN_DIR/candidate" --output "$RUN_DIR/rehearsal"
python3 apps/wb/desktop/scripts/stage.py local --allow-dirty
```

预演在新目录切换旧版、候选版、旧版。每一步检验四个静态站点文件、实际安装的 Caddy 片段、BlotLens 独立服务和网页文件，恢复后再核对旧版摘要。已有浏览器标签需要的上版 Vite 哈希资产按旧部署器约定保留，并逐个检查来源摘要。预演中的 systemd 和 Caddy 系统操作被模拟，生产更新器拒绝本机构建的预演清单。安装 Caddy 后运行 `python3 -m unittest discover -s "$DEPLOY" -p 'test_suite_release.py' -v` 可在环回地址测试真实 Caddy 配置以及合成后端的路径、Origin 和响应。该测试仅发送合成 JSON。

## 单仓候选和显式发布

完成主线 CI 后，在 Actions 手动运行 **Prepare and rehearse WispLab release**。输入新版本名、上一版来源仓和实际发布标签。工作流只读取 GitHub，验证旧版、候选版和恢复步骤，生成 `verified-candidate`。同步保存整个工件到发布档案。CI 工件保存 30 天，稳定版的静态包、独立服务包、部署清单与恢复记录进入 Release 附件，后续恢复可直接使用这些附件。

正式切换前，在独立预发布机安装候选服务和配置，核对 WB 同源 API、独立 BlotLens、浏览器离线导出、历史项目导入、既有域名和旧 Pages 的导出入口，再按下方恢复步骤恢复一次。真实 provider 检查需要另外授权；本机和 CI 默认用 mock。完成审批后在含同一提交的主仓运行下列命令。发布命令会重新对照 GitHub CI 原始产物并核对本地归档字节。中断后用同一份候选包和记录重试。

```sh
gh run download "$PREPARE_RUN_ID" --repo Gaoyuan-0423/wisplab-cli --name verified-candidate --dir "$CANDIDATE_DIR"
python3 apps/wb/deployment/wisplab/suite_release.py verify "$CANDIDATE_DIR"
python3 apps/wb/deployment/wisplab/suite_release.py publish --candidate "$CANDIDATE_DIR" --recovery "$CANDIDATE_DIR/recovery.json"
```

### 服务器与 BlotLens

1. 保存正在运行的 `deploy.py`、`update.py`、systemd 单元、Caddy 配置、两个服务的版本目录及 `/srv/wisplab/updater/state.json`。确认旧发布和服务包可读并校验 SHA256。
2. 将本目录的 `deploy.py` 和 `update.py` 安装到现有 `/srv/wisplab/bin/`，通过现有 SSH 运维路径部署。先暂停更新定时器，等待已启动的更新进程退出，记录原有固定标签及定时器状态。新 updater 对旧仓清单继续用 schema 1，对主仓清单用 schema 2。旧服务器上的脚本不会随源码更新。
3. 在运行 BlotLens 的主机暂存 `blotlens-linux.tar.gz`，核对 `deployment.json.blotlens.sha256` 后按独立服务部署说明切换。WB 主机需在环回 `127.0.0.1:4319` 运行受信任 origin 为 `https://wb.wisplab.top` 的服务，独立域名保留自己的 origin 与端口。若两者分属不同主机，请在两边安装同一服务包，分别记录旧目录。保留浏览器原始 Origin。不要把全新主机安装脚本直接用于已有 Caddy 实例。[独立及内嵌服务配置](../../../blotlens/deploy/README.md)
4. 在 WispLab 主机按已批准的标签运行安装命令。部署器依据已校验的 Web 包内 `release.json` 选择 Caddy 片段。WB 文件清单含有 `blotlens/index.html` 时，片段在 WB 站点把 `/blotlens/api/*` 转发到 4319 并剥去 `/blotlens`；首页、三个分析域及独立 BlotLens 的原有地址继续使用。检查四个 `/release.json`、独立和嵌入页面、模拟 API；获准转为常规跟随后，再安装主仓版 systemd service 单元、重新读取配置并解除固定。先验证再启用定时器。已有 `wisplab.caddy` 必须与本机安装路径对应的历史或现行官方模板逐字节相同；若有手改，部署会停止，应先核对来源。

```sh
sudo /usr/bin/python3 -I /srv/wisplab/bin/update.py --repository Gaoyuan-0423/wisplab-cli --tag "$APPROVED_TAG"
```

### 恢复上个版本

关闭本次发布的自动跟随。使用**上一版所在的仓库和标签**指定恢复目标。以下命令会将旧版固定在历史仓，持续保留定时任务的固定状态。若两版均来自主仓，仓库参数填写 `Gaoyuan-0423/wisplab-cli`。在独立 BlotLens 和 WB API 主机，将各服务的 `current` 链接原子切回保存的旧目录并重启；对于旧版 `20261025-apple-privacy`，静态包恢复后，部署器会一并恢复原版 `wisplab.caddy`，移除 WB 的内嵌 API 转发。若发布前没有 `blotlens-wb.service`，停用该单元、移除本次新增的单元文件并执行 `systemctl daemon-reload`。按备份恢复独立服务、updater 配置和定时器状态。逐个检查站点、静态包 SHA、独立服务包 SHA、健康状态和旧版项目导出。如需恢复旧版 Caddy/updater 实现，使用切换前保存的主机文件。

```sh
sudo /usr/bin/python3 -I /srv/wisplab/bin/update.py --repository Gaoyuan-0423/blot-workbench --tag "$OLD_WEB_TAG"
```

### 旧 Pages 和 30 天导出窗口

旧站点继续使用原项目路径和原浏览器存储。将 `legacy-pages-workflow.yml` 作为 `.github/workflows/wisplab-transition.yml` 安装到三个旧仓，各自明确触发一次。输入经批准的单仓工具提交、冻结旧版的标签及同一个**实际切换 UTC 时刻**。窗口内保留旧版应用和资产，首页显示导出提示。失效的嵌套书签会显示返回旧站导出的链接。跳转脚本由原项目的同源路径提供，兼容 WB 的内容安全策略。窗口截止后再次打开首页或失效书签，将前往新站根入口并保留原查询串和 hash。已经打开的导出会话可以继续完成。届时再运行同一个工作流，将页面替换为持久跳转页和 404 页面。归档旧仓前核对原 URL 在 GitHub Pages 当前设置下仍可访问，保留历史标签与 Issues。回退时用旧 Pages 工作流或保存的静态发布包恢复原站，旧域名在窗口期仍能导出用户的数据。

预演用 `legacy_pages.py --previous <旧包目录> --site wb --cutover <带时区的时刻> --at <模拟时刻> --output <新目录>`。分别测试第 0 天、第 29 天与第 30 天，以及 `pathology`、`pcr` 两个入口。
