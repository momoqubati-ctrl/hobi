import re

with open('D:\\medo\\hobi\\database_backup_fixed2.sql', 'r', encoding='utf-8') as f:
    content = f.read()

# Find rooms line
idx = content.find("general', '")
if idx >= 0:
    # Extract Arabic text
    start = idx + 11  # after "general', '"
    end = content.find("'", start)
    arabic = content[start:end]
    print("Room name:", arabic)
    print("Bytes:", arabic.encode('utf-8').hex())
    
    # Also get description
    end2 = content.find("'", end + 2)
    desc = content[end+2:end2]
    print("Description:", desc[:50])

# Count Arabic chars
arabic_count = sum(1 for c in content if 0x0600 <= ord(c) <= 0x06FF)
print(f"\nTotal Arabic characters: {arabic_count}")

# Check for any replacement characters
replacement = content.count('\ufffd')
print(f"Replacement characters (�): {replacement}")

# Verify file starts with correct header
print(f"\nFile starts with: {content[:50]}")
print(f"File ends with: {content[-50:]}")

# Check no USER-DEFINED remains
if 'USER-DEFINED' in content:
    print("WARNING: USER-DEFINED still found!")
else:
    print("OK: No USER-DEFINED types")

# Check no ::regclass in CREATE TABLE defaults
if 'DEFAULT nextval(' in content and '::regclass' in content:
    print("WARNING: ::regclass still found in DEFAULT!")
else:
    print("OK: No ::regclass in CREATE TABLE defaults")

# Check role_permissions vs roles order
roles_idx = content.find("-- Data: roles (1 rows)")
rp_idx = content.find("-- Data: role_permissions (22 rows)")
if roles_idx < rp_idx:
    print("OK: roles comes before role_permissions")
else:
    print("WARNING: wrong order!")

# Check session_replication_role
if 'session_replication_role = replica' in content:
    print("OK: session_replication_role = replica found")
if 'session_replication_role = DEFAULT' in content:
    print("OK: session_replication_role = DEFAULT found")
