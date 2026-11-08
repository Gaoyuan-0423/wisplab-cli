# Experimental-unit contract integration — 2026-11-08

The November validation branch was prepared against CLI `714197d`. This PR integrates its qPCR design contract onto current CLI main `acef8fb` (v0.8.1), retaining the newer import, pairing, efficiency normalization, cancellation, image-review and provenance fixes. It does not replace main with the older validation snapshot.

## Result contract

- `experimentalDesign` explicitly maps plate/sample sources to units and groups. Confirmation, coverage and supported design semantics belong to the compatible qPCR engine. CLI configuration and MCP/JavaScript arguments carry the same structure; MCP never silently inherits confirmation from server configuration.
- Existing `biologicalDesign`, including explicit pairing and its independent bridge calculations, remains supported. Supplying both designs is rejected. The engine-specific `designStatus`/`designIssues` fields are not emitted for a biologicalDesign result.
- With neither design, `primaryAnalysis.kind` is `descriptive-only`, sample p-values are null and the comparison list is empty. This intentionally changes the previous default well-level inference contract; expression descriptions and QC/NTC diagnostics remain available.
- Invalid or unsupported requested experimental designs retain an `experimental-units` primary error. No alternate design or legacy well-level inference is substituted. Unconfirmed designs and insufficient independent units cannot manufacture p-values.
- QC partitions technical wells by plate/sample/target. Provenance retains the supplied unit mapping and the engine's result eligibility.

See the bilingual [design guide](qpcr-design.md), [existing biological design](qpcr-groups.md), and [qPCR engine PR #12](https://github.com/Gaoyuan-0423/pcr-workbench/pull/12).

## Separate engine baselines

`engines.lock.json` remains the established compatibility baseline. Its qPCR engine does not implement experimentalDesign, so an explicit request against that version is reported unsupported. Existing biologicalDesign behavior continues to be exercised against the locked engine.

The new contract has a separate exact candidate revision in [experimental-unit-engine.json](../tests/integration/experimental-unit-engine.json): `7eba925fc9404f5c440ea9da6597a58e13ac5ef5`. The dedicated CI job checks out this clean revision and runs the real engine through API, CLI and MCP. This pin does not imply that the corresponding engine PR has merged or that the entire default engine lock was upgraded.

```sh
npm run check
npm test
WISPLAB_CONFIG=.integration/config.json npm run test:integration
WISPLAB_UNIT_ENGINE=/absolute/path/to/clean/candidate-pcr npm run test:unit-engine
```

## Checks recorded during integration

| Check | Result |
| --- | --- |
| Syntax checks | Passed |
| Fast Node tests | 120/120 passed |
| Real locked qPCR import, paired/unpaired and efficiency suites | 14/14 test nodes passed |
| Real candidate experimental-unit contract | 6/6 test nodes passed (five scenarios plus suite) |
| Complete pinned-engine coverage | Initial run: 28 passed, 1 suite blocked by a local dependency symlink; the blocked suite passed 11/11 test nodes after environment correction |

The candidate cases use six declared synthetic units with known ΔCt values, a hand-specified Welch result, duplicated technical wells, missing confirmation, unsupported pairing, design conflicts, retained biologicalDesign behavior, and actual CLI/MCP routing. The test verifies the candidate Git revision and requires a clean checkout. The separate locked-qPCR cases retain the previously specified R references for efficiencies, paired/unpaired effects and confidence intervals; their tolerance is unchanged.

During integration, adding a shared MCP validation import exposed two temporary test fixtures that did not copy the new dependency. Their copied module lists were completed; no assertions or runtime behavior were weakened. Final fast tests pass.

All new fixtures are synthetic. These results establish software compatibility and the stated arithmetic/dispatch behavior; they do not establish independent biological replication, external experimental accuracy, user benefit or scientific validity. The original November development checks are historical evidence for their original source bytes, not validation of this integrated revision.


The initial complete local integration run refused the WB checkout because its `node_modules` symlink was visible as an untracked path. Replacing that local symlink with an ignored dependency directory restored the clean-checkout precondition. No engine source, lock revision, expected value or cleanliness assertion changed. The blocked pinned-engine suite was then rerun successfully; the other suites had already passed. CI runs the complete integration command from fresh installed dependencies.
