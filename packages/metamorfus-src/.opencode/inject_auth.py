import re
import sys

path = sys.argv[1]
with open(path) as f:
    src = f.read()

AUTH = 'AUTH'

# 1. For fetch calls that already have a headers object, inject AUTH.
src = re.sub(
    r"(\bfetch\(`\$\{baseUrl\(\)\}/[^`]+`,\s*\{\s*headers:\s*\{)([^}]*)(\}\s*,)",
    lambda m: f'{m.group(1)} authorization: {AUTH}.authorization, {m.group(2)}{m.group(3)}',
    src,
)

# 2. For fetch calls that have body but no headers — add headers.
src = re.sub(
    r"(\bfetch\(`\$\{baseUrl\(\)\}/[^`]+`,\s*\{\s*method:[^,]+,\s*)(body:)",
    r"\1headers: { ...AUTH, \"Content-Type\": \"application/json\" },\n      \2",
    src,
)

# 3. For fetch calls with no headers and no body (GET), add headers.
src = re.sub(
    r"(\bfetch\(`\$\{baseUrl\(\)\}/[^`]+`\))",
    lambda m: f"{m.group(1).rstrip(')')}, {{ headers: AUTH }})" if "headers" not in m.group(1) else m.group(0),
    src,
)

with open(path, "w") as f:
    f.write(src)
print("injected")
