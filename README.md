# kotlin-toolchain-check

Build and run registered **JetBrains Kotlin Toolchain** checks with GitHub job
summaries, JUnit failure annotations, and test-report artifacts. Works on Linux,
macOS, and Windows. Requires Node.js 22+, Bash, and a configured Kotlin Toolchain.

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@v7
  - uses: Heapy/setup-kotlin-toolchain@v1
  - uses: Heapy/kotlin-toolchain-check@v1
```

Use release commit SHAs for immutable action references. This action does not
need `checks: write`, so it also works on fork pull requests.

| Input | Default | Purpose |
|---|---|---|
| `working-directory` | `.` | Project folder relative to the workspace |
| `checks` | empty | Run all checks, or select comma/whitespace-separated names |
| `modules` | empty | Select modules; empty selects all |
| `skip` | empty | Checks to skip, such as `tests` |
| `build` | `true` | Compile before checking |
| `upload-reports` | `true` | Upload reports even when checks fail |
| `artifact-name` | OS/architecture/job based | Override for matrix entries sharing a platform |

Outputs: `tests`, `failures`, `errors`, `skipped`, and `exit-code`.

`kotlin check` includes tests and registered plugin checks. JUnit XML is collected
from `build/reports/**/TEST-*.xml`. Only reports freshly written by this invocation
are counted; nested suites do not duplicate test totals. Platforms that do not
emit JUnit XML still use the CLI exit status, with an explicit no-report summary.
Failures or report parsing errors fail the action. Report artifacts are retained
for seven days; disable uploading if your tests put sensitive information in reports.
The action does not upload toolchain logs or environment files.

Downloaded dependencies, JDKs, and CLI caching are handled by the separate setup
action. Local build output is not cached by this action. The bundled runtime
contains its XML parser, so consumers do not need to install npm dependencies.

Development: `npm ci`, `npm test`, and `npm run build`. Commit `dist/index.mjs`
when source or dependencies change. CI checks the bundle and exercises both a
passing and deliberately failing Kotlin fixture on Linux, macOS, and Windows.

## Related actions

- [setup-kotlin-toolchain](https://github.com/Heapy/setup-kotlin-toolchain)
- [update-kotlin-toolchain](https://github.com/Heapy/update-kotlin-toolchain)
- [kotlin-toolchain-publish](https://github.com/Heapy/kotlin-toolchain-publish)
