#!/bin/sh
set -e

. /scripts/lib/common.sh

TARGET="${TEST_SUITE:-all}"
echo "============================================="
echo "  Social Radio E2E Suite — Running: $TARGET"
echo "============================================="

run_suite() {
  SUITE_FILE="$1"
  if [ -f "$SUITE_FILE" ]; then
    /bin/sh "$SUITE_FILE"
  else
    fail "Suite file $SUITE_FILE not found"
  fi
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
  all|"")
    run_suite /scripts/suites/01-healthcheck.sh
    run_suite /scripts/suites/02-auth.sh
    run_suite /scripts/suites/03-channels.sh
    run_suite /scripts/suites/04-security.sh
    run_suite /scripts/suites/05-playback.sh
    run_suite /scripts/suites/06-scraping.sh
    run_suite /scripts/suites/07-ai-storage.sh
    run_suite /scripts/suites/08-broadcast.sh
    ;;
  *)
    fail "Unknown test suite: $TARGET (Valid options: 01, 02, 03, 04, 05, 06, 07, 08, all)"
    ;;
esac

echo ""
echo "============================================="
echo "  OK - All requested E2E checks passed"
echo "============================================="
