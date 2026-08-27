#!/bin/sh
set -e

. /scripts/lib/common.sh

ensure_base_fixtures

echo ""
echo "=== Section 2: Auth & Identity ==="

echo "2. POST /auth/login (Admin -> 201)"
assert_status POST "$BASE_URL/auth/login" 201 \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
TOKEN=$(echo "$BODY" | jq -r '.accessToken')
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || fail "admin accessToken not found in response"
echo "  Token acquired (admin)"

echo "3. GET /users/me (Admin -> 200)"
assert_status GET "$BASE_URL/users/me" 200 \
  -H "Authorization: Bearer $TOKEN"
assert_jq ".email == \"$EMAIL\"" 'email matches admin email'
assert_jq '.id != null' 'id present'
assert_jq '.createdAt != null' 'createdAt present'

echo "4. POST /auth/login (Regular User -> 201)"
assert_status POST "$BASE_URL/auth/login" 201 \
  -H "Content-Type: application/json" \
  -d '{"email":"user@socialradio.com","password":"UserPass123!"}'
REG_TOKEN=$(echo "$BODY" | jq -r '.accessToken')
[ -n "$REG_TOKEN" ] && [ "$REG_TOKEN" != "null" ] || fail "user accessToken not found in response"
echo "  Token acquired (user)"

assert_status GET "$BASE_URL/users/me" 200 \
  -H "Authorization: Bearer $REG_TOKEN"
assert_jq '.email == "user@socialradio.com"' 'email matches regular user email'
assert_jq '.id != null' 'regular user id present'

echo "5. POST /auth/login (Empty JSON Body -> 400)"
assert_status POST "$BASE_URL/auth/login" 400 \
  -H "Content-Type: application/json" \
  -d '{}'
assert_jq '.statusCode == 400' 'body confirms 400'
assert_jq '.message | type == "array" and length > 0' 'validation messages present'

echo "6. POST /auth/login (Invalid Email -> 400)"
assert_status POST "$BASE_URL/auth/login" 400 \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email","password":"AnyPassword1!"}'
assert_jq '.statusCode == 400' 'body confirms 400'
assert_jq '.message | if type == "array" then .[] else . end | contains("email")' 'message mentions email'

echo "7. POST /auth/login (Wrong Password -> 401)"
assert_status POST "$BASE_URL/auth/login" 401 \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"WrongPassword999!\"}"
assert_jq '.message == "Invalid credentials"' 'no user enumeration message'

echo "8. POST /auth/login (Non-existent Email -> 401)"
assert_status POST "$BASE_URL/auth/login" 401 \
  -H "Content-Type: application/json" \
  -d '{"email":"ghost@nonexistent.com","password":"SomePassword1!"}'
assert_jq '.message == "Invalid credentials"' 'same message as wrong password'

echo "9. GET /users/me (No Auth -> 401)"
assert_status GET "$BASE_URL/users/me" 401
assert_jq '.statusCode == 401' 'body confirms 401'

echo "10. GET /users/me (Malformed JWT -> 401)"
assert_status GET "$BASE_URL/users/me" 401 \
  -H "Authorization: Bearer not.a.valid.jwt.token"
assert_jq '.statusCode == 401' 'body confirms 401'
