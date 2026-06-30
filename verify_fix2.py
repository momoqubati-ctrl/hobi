import re

with open('D:\\medo\\hobi\\database_backup_fixed2.sql', 'r', encoding='utf-8') as f:
    content = f.read()

# Check for replacement characters
replacement = content.count('\ufffd')
print(f"Replacement characters (U+FFFD): {replacement}")

if replacement > 0:
    # Find where they are
    for i, c in enumerate(content):
        if c == '\ufffd':
            print(f"  Found at position {i}: ...{content[max(0,i-20):i+20]}...")
            break

# Verify key fixes
checks = [
    ("USER-DEFINED", "No USER-DEFINED types remaining"),
    ("::regclass", "No ::regclass in CREATE TABLE defaults"),
]
for term, msg in checks:
    if term in content:
        print(f"FAIL: {term} still found!")
    else:
        print(f"OK: {msg}")

# Check ordering
roles_idx = content.find("-- Data: roles (1 rows)")
rp_idx = content.find("-- Data: role_permissions (22 rows)")
print(f"roles at: {roles_idx}, role_permissions at: {rp_idx}")
print("OK: roles before role_permissions" if roles_idx < rp_idx else "FAIL: wrong order!")

# Check session_replication
for term in ["session_replication_role = replica", "session_replication_role = DEFAULT"]:
    print(f"OK: '{term}' found" if term in content else f"FAIL: '{term}' not found!")

# Count Arabic chars
arabic_count = sum(1 for c in content if 0x0600 <= ord(c) <= 0x06FF)
print(f"Total Arabic characters: {arabic_count}")

print("\nAll checks passed!" if replacement == 0 and 'USER-DEFINED' not in content and '::regclass' not in content else "\nSome issues remain")
