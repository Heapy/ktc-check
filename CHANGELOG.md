# Changelog

## 1.1.1

- Add `command-timeout-minutes` to configure the timeout for each CLI command,
  including separate build and test invocations. The default remains 20 minutes.

## 1.1.0

- Add a `platforms` input for host-specific builds and tests, preserving module and
  check selection and running plugin checks without repeating built-in tests.
- Document all Kotlin Toolchain 0.13.0 target names and runner limitations.

## 1.0.0

Initial release under Apache-2.0.
