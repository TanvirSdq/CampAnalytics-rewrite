#!/usr/bin/env bash
# ==============================================================================
# verify_routes.sh — Opaque-box HTTP Verification Script for CampAnalytics
# Checks route status codes, content-type headers, and distinctive body markers.
# ==============================================================================

set -u

BASE_URL="${1:-${BASE_URL:-http://127.0.0.1:3000}}"
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Reset proxy settings for localhost testing
export no_proxy="*"
export NO_PROXY="*"

echo "======================================================================"
echo "CampAnalytics Route Verification Suite"
echo "Target Base URL: ${BASE_URL}"
echo "======================================================================"

# Helper function to test an endpoint
# Arguments:
#   $1: Test Name
#   $2: HTTP Method (GET/POST)
#   $3: Path
#   $4: Expected HTTP Status
#   $5: Required body substring (optional, "" if none)
#   $6: Forbidden body substring (optional, "" if none)
#   $7: POST body data (optional, "" if none)
check_endpoint() {
    local name="$1"
    local method="$2"
    local path="$3"
    local expected_status="$4"
    local required_str="$5"
    local forbidden_str="$6"
    local post_data="${7:-}"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    local url="${BASE_URL}${path}"

    local temp_resp
    temp_resp=$(mktemp)
    local temp_headers
    temp_headers=$(mktemp)

    local curl_opts=(--noproxy "*" -s -S -X "$method" -D "$temp_headers" -o "$temp_resp")
    if [ -n "$post_data" ]; then
        curl_opts+=(-d "$post_data" -H "Content-Type: application/x-www-form-urlencoded")
    fi

    curl "${curl_opts[@]}" "$url" 2>/dev/null
    local curl_exit=$?

    if [ $curl_exit -ne 0 ]; then
        echo "❌ [FAIL] ${name}: Connection failed (curl exit code: $curl_exit)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        rm -f "$temp_resp" "$temp_headers"
        return 1
    fi

    local actual_status
    actual_status=$(head -n 1 "$temp_headers" | awk '{print $2}')
    local body
    body=$(cat "$temp_resp")

    local test_passed=true
    local failure_reason=""

    if [ "$actual_status" != "$expected_status" ]; then
        test_passed=false
        failure_reason="Expected status $expected_status, got $actual_status"
    elif [ -n "$required_str" ] && ! echo "$body" | grep -Fq "$required_str"; then
        test_passed=false
        failure_reason="Missing expected body marker: '$required_str'"
    elif [ -n "$forbidden_str" ] && echo "$body" | grep -Fq "$forbidden_str"; then
        test_passed=false
        failure_reason="Found forbidden body marker: '$forbidden_str'"
    fi

    if [ "$test_passed" = true ]; then
        echo "✅ [PASS] ${name} (Status: ${actual_status})"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo "❌ [FAIL] ${name}: ${failure_reason}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi

    rm -f "$temp_resp" "$temp_headers"
}

# ------------------------------------------------------------------------------
# 1. Core Endpoints
# ------------------------------------------------------------------------------
echo ""
echo "--- 1. Core Endpoints & Liveness ---"
check_endpoint "Liveness Check (/healthz)" "GET" "/healthz" "200" "OK" ""
check_endpoint "Home Landing Page (/)" "GET" "/" "200" "CampTools" ""
check_endpoint "Tools Directory (/tools)" "GET" "/tools" "200" "CampTools" ""
check_endpoint "Documentation Page (/documentation)" "GET" "/documentation" "200" "Documentation" ""
check_endpoint "Documentation Alias (/info)" "GET" "/info" "200" "Documentation" ""

# ------------------------------------------------------------------------------
# 2. Tool Routes & Template Routing Integrity (R1 Acceptance)
# ------------------------------------------------------------------------------
echo ""
echo "--- 2. Tool Routes (R1 Routing Resolution & Negative Check) ---"
check_endpoint "Influx Tool (/influx)" "GET" "/influx" "200" "Year-over-Year New User Influx" "Welcome to CampTools"
check_endpoint "Health Tool (/health)" "GET" "/health" "200" "scorecard-grid" "Welcome to CampTools"
check_endpoint "Retention Tool (/retention)" "GET" "/retention" "200" "Retention Analysis" "Welcome to CampTools"
check_endpoint "Content Utility Tool (/utility)" "GET" "/utility" "200" "Content Utility" "Welcome to CampTools"
check_endpoint "Quality Recognition Tool (/quality)" "GET" "/quality" "200" "Quality Recognition" "Welcome to CampTools"

# ------------------------------------------------------------------------------
# 3. API & Boundary Validation
# ------------------------------------------------------------------------------
echo ""
echo "--- 3. API Endpoints & Boundary Cases ---"
check_endpoint "Heatmaps API Missing Params" "GET" "/api/retention/heatmaps" "400" "Missing target_campaigns parameter" ""
check_endpoint "Heatmaps API Invalid Code" "GET" "/api/retention/heatmaps?target_campaigns=invalid-xyz-999" "400" "No valid campaign codes found" ""
check_endpoint "Nonexistent Route (404)" "GET" "/nonexistent-route-xyz" "404" "" ""
check_endpoint "Static CSS Stylesheet" "GET" "/styles.css" "200" ":root" ""

# ------------------------------------------------------------------------------
# 4. Form Submissions (POST)
# ------------------------------------------------------------------------------
echo ""
echo "--- 4. POST Form Submissions ---"
check_endpoint "POST /influx" "POST" "/influx" "200" "influx-form" "Welcome to CampTools" "influx_event_type=wlm&influx_country=bd&influx_yr_start=2021&influx_yr_end=2023"
check_endpoint "POST /health" "POST" "/health" "200" "health-form" "Welcome to CampTools" "target_event=wlmbd23&comp_mode=Previous+Year+Baseline"

echo ""
echo "======================================================================"
echo "Verification Summary: ${PASSED_TESTS}/${TOTAL_TESTS} passed (${FAILED_TESTS} failed)"
echo "======================================================================"

if [ $FAILED_TESTS -eq 0 ]; then
    echo "🎉 ALL E2E ROUTE CHECKS PASSED SUCCESSFULLY!"
    exit 0
else
    echo "⚠️ ROUTING VERIFICATION FAILED: Found ${FAILED_TESTS} defect(s)."
    exit 1
fi
