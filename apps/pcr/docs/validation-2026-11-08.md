# Experimental-unit validation, 8 November 2026

This change makes an explicitly confirmed independent experimental-unit design the boundary for qPCR group inference. Unconfirmed, invalid, paired and repeated-measures designs remain descriptive. Software checks do not establish the biological independence of user-provided units or the validity of a scientific conclusion.

## Behavior and numerical meaning

- Source identity includes plate and sample. Same display names on different plates are not silently merged; a user can explicitly map technical measurements across plates to one unit.
- Technical Cq measurements are averaged within each unit and gene. Each eligible unit contributes one ΔCt, and control units receive equal weight regardless of their technical-well counts. Every selected reference must be available for a confirmed unit to enter group inference.
- Group tables separate `nBio` from `nTech`. Sample/technical-description rows do not carry group p values. Two groups use Welch t; three or more total groups include the control in ANOVA and the Dunnett pooled variance. Insufficient units, identity conflicts and unsupported designs prevent inference.
- Individual reference efficiencies are retained before geometric pooling of relative quantities. This preserves the upstream per-reference correction, direct Welch-tail evaluation, single-reference guidance and Linux dependency-lock fixes present in the integration base (`2ce8f3f`). A stable single reference is sufficient; additional references are optional.
- A confirmed unit's FC is calculated from its mean Cq. Group `foldChange` is the transformed group mean, while `fcMean` is the arithmetic mean of unit FC values; these are different summaries. The existing descriptive path retains the Livak transform of mean ΔΔCt and, when efficiency correction is active, the arithmetic mean of technical-well FC values. Technical FC SD is not biological variation.
- CSV/Excel, charts and Prism XML distinguish technical measurements, independent-unit results and design metadata. Missing measurements remain missing rather than becoming zero-valued observations. A Prism row is not created by treating a mean and its SD as two replicates.
- The current quality report is recomputed from current rows and configuration. Import-time standard-curve/RDML notes remain labeled historical. Changing the analysis or selected model remounts the interpretation card and aborts its pending request; it does not automatically request another interpretation.

## Checks actually run on the integrated change

| Check | Command | Result |
| --- | --- | --- |
| All unit tests | `npm test` | 24 files, **207 tests passed** |
| Type checking and production build | `npm run build` | Passed |
| Lint | `npm run lint` | Exit 0; 23 existing warnings remain |
| All browser tests | `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=5188 npx playwright test --workers=1 --reporter=line` | **28 tests passed** |
| Whitespace/conflict check | `git diff --check` | Passed |

Local runtime: Node v24.14.1, npm 11.11.0, Vite 8.3.4 and installed Chrome 156.0.8078.81. CI separately installs the locked dependencies and runs its configured Node 22 and Chromium checks. The build retains bundle-size and mixed static/dynamic-import warnings; no performance claim is made.

Targeted assertions cover three units with three technical wells each, one-unit groups that must not receive p values, duplication invariance, unequal technical counts, cross-plate identity, missing references, conflicting groups/pair IDs, control-inclusive ANOVA/Dunnett, chart measurement levels, exported workbook/Prism structure, and project design round trips. The upstream per-reference efficiency and extreme-tail probability regressions remain in the suite. An additional quantity-domain hand calculation checks optional references with different efficiencies and unequal control-unit technical counts together.

These counts are software assertions, not experimental sample sizes. The earlier development numerical report was produced before the latest upstream integration and is not used as an exact-source validation claim for this PR. No new original instrument/vendor data or private local evidence archive is added here.

## Remaining boundaries

D09 (report/interpretation provenance) is **partially implemented**. A dedicated end-to-end acceptance test with delayed external model responses and more complete interpretation-source archiving remain outstanding. No real external-model interpretation test was performed.

Prism exports were checked as XML and browser downloads, not by importing into the GraphPad Prism desktop application. No independent biological validation, new raw data, external holdout study, blinded adjudication, user-benefit study or clinical validation was performed. Paired/repeated-measures inference is not implemented in this engine. Minimum computational sample-size gates do not confirm power or model assumptions.

## 中文说明

本轮先明确来源、独立单位与技术测量关系，再在单位内汇总；只有已确认且无冲突的独立组设计进入组间推断。技术孔不增加 `nBio`，跨板同名不自动合并，缺少内参或有效单位不足时不输出相应 p 值。当前报告随数据与配置重算，旧导入记录明确标为历史；解读失效保护不会自动新增模型调用。

整合版本实际通过 207 个单元测试、28 个浏览器测试、类型检查及构建；lint 退出码为 0，仍有 23 条已有警告。D09 仅部分完成，尚未执行真实外部模型及延迟回复端到端验收，也未做独立生物学验证。运行成功和数值回归不能替代实验者确认采样独立性、参考基因适用性、统计假设与结论有效性。
