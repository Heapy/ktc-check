# ktc-check

Build and run registered **JetBrains Kotlin Toolchain** checks with GitHub job
summaries, JUnit failure annotations, and test-report artifacts. Works on Linux,
macOS, and Windows. Requires Node.js 22+, Bash, and a configured Kotlin Toolchain.

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@v7
  - uses: Heapy/setup-ktc@v1
  - uses: Heapy/ktc-check@v1
```

Use release commit SHAs for immutable action references. This action does not
need `checks: write`, so it also works on fork pull requests.

| Input | Default | Purpose |
|---|---|---|
| `working-directory` | `.` | Project folder relative to the workspace |
| `checks` | empty | Run all checks, or select comma/whitespace-separated names |
| `modules` | empty | Select modules; empty selects all |
| `platforms` | empty | Comma/whitespace-separated build and test platforms; empty uses CLI defaults |
| `skip` | empty | Checks to skip, such as `tests` |
| `build` | `true` | Compile before checking |
| `upload-reports` | `true` | Upload reports even when checks fail |
| `artifact-name` | OS/architecture/job based | Override for matrix entries sharing a platform |

Outputs: `tests`, `failures`, `errors`, `skipped`, and `exit-code`.

### Platform selection

Select the targets supported by each compiler host directly in the action:

```yaml
- uses: Heapy/ktc-check@v1
  with:
    checks: tests
    platforms: linuxX64, jvm
    artifact-name: kotlin-reports-linuxX64
```

Use the following target names for Kotlin Toolchain 0.13.0, as listed in its
[supported platforms documentation](https://github.com/JetBrains/kotlin-toolchain/blob/v0.13.0/docs/src/user-guide/multiplatform.md#supported-platforms):

| Target group | Platform names |
|---|---|
| JVM | `jvm` |
| Android | `android` |
| JavaScript | `js` |
| WebAssembly | `wasmJs`, `wasmWasi` |
| Linux | `linuxX64`, `linuxArm64` |
| Windows | `mingwX64` |
| macOS | `macosArm64`, `macosX64` (deprecated) |
| iOS | `iosArm64`, `iosSimulatorArm64`, `iosX64` |
| watchOS | `watchosArm32` (deprecated), `watchosArm64`, `watchosDeviceArm64`, `watchosSimulatorArm64` |
| tvOS | `tvosArm64`, `tvosSimulatorArm64`, `tvosX64` (deprecated) |
| Android Native | `androidNativeArm32`, `androidNativeArm64`, `androidNativeX64`, `androidNativeX86` |

Choose targets declared by your modules. This list describes toolchain target
identifiers; build and test support depends on the module's product type, the
toolchain version, and the runner. The toolchain does not support or test all
targets equally.

With `platforms` set, the action forwards each platform to `kotlin build` and runs
the built-in `tests` check through `kotlin test --platform ...`. Toolchain 0.13's
`kotlin check` does not accept platform selection, so remaining plugin checks run
separately with the selected modules. For default check selection, the action uses
`kotlin show checks --format plain` to discover plugin checks before running
`kotlin check --skip tests`; projects with only built-in tests skip that extra
check invocation. Explicitly selected plugin checks run by name. Plugin checks themselves
retain their normal platform behavior. An empty `platforms` input preserves the
existing build/check commands. `checks`, `skip`, and `build: false` still apply;
selecting only plugin checks does not run tests.

Build prerequisites such as frontend assets before invoking the action. If a
separate step already built the required executables, use `build: false`. Select
only platforms that can be tested on the runner; cross-compiling an executable
does not make that runner able to execute it.

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

- [setup-ktc](https://github.com/Heapy/setup-ktc)
- [update-ktc](https://github.com/Heapy/update-ktc)
- [ktc-publish](https://github.com/Heapy/ktc-publish)

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party
components retain their original licenses.
