#!/usr/bin/env bash
set -euo pipefail

integration_tests=($(find src/__tests__/integration -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | sort))
unit_tests=($(find src/__tests__/unit -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | sort))
source_tests=($(find src/app src/components src/hooks src/lib src/stores -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | sort))
vitest_args=("$@")

# Coverage must be collected in one Vitest process. Running it through the
# batches below would clean and overwrite the report for every batch, leaving CI
# with coverage for only the final handful of tests.
for arg in "$@"; do
  if [[ "$arg" == --coverage* ]]; then
    vitest run "$@"
    exit $?
  fi
done

# NOTE: vitest_args is expanded via the ${arr[@]+...} guard everywhere below —
# macOS ships bash 3.2, where expanding an EMPTY array under `set -u` aborts
# with "unbound variable", which would break the no-flags `npm test` path.
run_batches() {
  local batch_size="$1"
  shift
  local batch=()

  for file in "$@"; do
    batch+=("$file")
    if [ "${#batch[@]}" -eq "$batch_size" ]; then
      vitest run "${batch[@]}" ${vitest_args[@]+"${vitest_args[@]}"}
      batch=()
    fi
  done

  if [ "${#batch[@]}" -gt 0 ]; then
    vitest run "${batch[@]}" ${vitest_args[@]+"${vitest_args[@]}"}
  fi
}

run_batches 1 "${integration_tests[@]}"
run_batches 10 "${unit_tests[@]}"
run_batches 10 "${source_tests[@]}"
