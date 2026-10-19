#!/bin/sh
set -e

. /scripts/lib/common.sh

TARGET="${TEST_SUITE:-all}"
echo "============================================="
echo "  Social Radio E2E Suite — Running: $TARGET"
echo "============================================="

RESULTS=""
FAILED_SUITES=""
SUITE_COUNT=0
TOTAL_ON_ONE=0
TOTAL_ON_TWO=0
PREREQ_FAILED=0

# Suites are independent once the prerequisites pass: each one creates its own
# channel and loads its own fixtures. So a failure must not end the run — the
# suites after it still have something to say, and stopping at the first one
# means a second full run to learn the next thing.
run_suite() {
  SUITE_FILE="$1"
  SUITE_NAME=$(basename "$SUITE_FILE" .sh)
  if [ ! -f "$SUITE_FILE" ]; then
    fail "Suite file $SUITE_FILE not found"
  fi

  # Every request a suite makes through the shared helper is routed to one of the
  # instances in turn, and each one records which process answered. That file is how
  # this script can tell whether a suite really ran against the whole stack or only
  # proved something about one process.
  INSTANCE_LOG="/tmp/instances-$$-$SUITE_NAME"
  : > "$INSTANCE_LOG"
  export INSTANCE_LOG

  # An `if` condition is exempt from `set -e`, so the rest of the script keeps
  # its guard while a failing suite only records itself.
  if /bin/sh "$SUITE_FILE"; then
    SUITE_PASSED=1
  else
    SUITE_PASSED=0
  fi

  # grep -c prints 0 and exits non-zero when there is nothing to count, so the
  # fallback must replace the value rather than append to it.
  ON_ONE=$(grep -c '^app$' "$INSTANCE_LOG" 2>/dev/null) || ON_ONE=0
  ON_TWO=$(grep -c '^app2$' "$INSTANCE_LOG" 2>/dev/null) || ON_TWO=0
  rm -f "$INSTANCE_LOG"

  # A suite whose assertions pass but which never reached the second instance fails
  # anyway: it is evidence about one process, not about the stack.
  if [ "$SUITE_PASSED" = "1" ] &&
    [ "$INSTANCE_ONE_URL" != "$INSTANCE_TWO_URL" ] && [ "$ON_TWO" = "0" ]; then
    echo "  ⛔ $SUITE_NAME never reached the second instance ($ON_ONE call(s) on app, 0 on app2)"
    RESULTS="$RESULTS
  FAIL $SUITE_NAME (single instance)"
    FAILED_SUITES="$FAILED_SUITES $SUITE_NAME(single-instance)"
  elif [ "$SUITE_PASSED" = "1" ]; then
    RESULTS="$RESULTS
  PASS $SUITE_NAME"
    if [ "$INSTANCE_ONE_URL" != "$INSTANCE_TWO_URL" ]; then
      echo "  instances exercised: app $ON_ONE, app2 $ON_TWO"
      TOTAL_ON_ONE=$((TOTAL_ON_ONE + ON_ONE))
      TOTAL_ON_TWO=$((TOTAL_ON_TWO + ON_TWO))
    fi
  else
    RESULTS="$RESULTS
  FAIL $SUITE_NAME"
    FAILED_SUITES="$FAILED_SUITES $SUITE_NAME"
    case "$SUITE_NAME" in
      01-healthcheck | 02-auth) PREREQ_FAILED=1 ;;
    esac
  fi

  SUITE_COUNT=$((SUITE_COUNT + 1))
}

case "$TARGET" in
  01|health|healthcheck)
    run_suite /scripts/suites/01-healthcheck.sh
    ;;
  02|auth)
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    ;;
  03|channel|channels)
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    run_suite /scripts/suites/03-channels.sh
    ;;
  04|security|rbac|guards)
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    run_suite /scripts/suites/04-security.sh
    ;;
  05|playback|queue|idle)
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    run_suite /scripts/suites/05-playback.sh
    ;;
  06|scrape|scraping|reddit)
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    run_suite /scripts/suites/06-scraping.sh
    ;;
  07|ai|talk|storage)
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    run_suite /scripts/suites/07-ai-storage.sh
    ;;
  08|broadcast|stream|radio|hls)
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    run_suite /scripts/suites/08-broadcast.sh
    ;;
  10|instances|multi|race)
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    run_suite /scripts/suites/10-multi-instance.sh
    ;;
  09|continuity|refusal)
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    run_suite /scripts/suites/09-continuity-refusal.sh
    run_suite /scripts/suites/10-multi-instance.sh
    ;;
  all|"")
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    run_suite /scripts/suites/03-channels.sh
    run_suite /scripts/suites/04-security.sh
    run_suite /scripts/suites/05-playback.sh
    run_suite /scripts/suites/06-scraping.sh
    run_suite /scripts/suites/07-ai-storage.sh
    run_suite /scripts/suites/08-broadcast.sh
    run_suite /scripts/suites/09-continuity-refusal.sh
    run_suite /scripts/suites/10-multi-instance.sh
    ;;
  *)
    fail "Unknown test suite: $TARGET (Valid options: 01, 02, 03, 04, 05, 06, 07, 08, all)"
    ;;
esac

echo ""
echo "============================================="
echo "  Per-suite results (01 and 02 are the prerequisites every target runs)"
echo "============================================="
printf '%s\n' "$RESULTS"

FAILED_COUNT=$(printf '%s' "$FAILED_SUITES" | wc -w | tr -d ' ')
echo ""
echo "============================================="
if [ "$FAILED_COUNT" -eq 0 ]; then
  if [ "$SUITE_COUNT" -eq 1 ]; then
    echo "  OK - All requested E2E checks passed (1 suite)"
  else
    echo "  OK - All requested E2E checks passed ($SUITE_COUNT suites)"
  fi
  if [ "$TOTAL_ON_TWO" -gt 0 ]; then
    echo "  Every suite crossed the process boundary: $TOTAL_ON_ONE call(s) answered by app, $TOTAL_ON_TWO by app2."
  fi
else
  echo "  FAILED - $FAILED_COUNT of $SUITE_COUNT suites:$FAILED_SUITES"
  if [ "$PREREQ_FAILED" -eq 1 ]; then
    echo "  A prerequisite failed (app not healthy or auth broken), so every"
    echo "  suite after it is expected to fail too - fix that first."
  fi
  echo "============================================="
  exit 1
fi
echo "============================================="
