import re

# Read original file as bytes
with open('D:\\medo\\hobi\\database_backup.sql', 'rb') as f:
    content = f.read()

# Strip BOM if present
if content[:3] == b'\xef\xbb\xbf':
    content = content[3:]

# Decode as UTF-8
text = content.decode('utf-8')

# === 1. Fix USER-DEFINED types ===
text = text.replace('"status" USER-DEFINED,', '"status" text,')
text = text.replace('"type" USER-DEFINED NOT NULL,', '"type" text NOT NULL,')
text = text.replace('"role" USER-DEFINED NOT NULL DEFAULT \'member\'::account_role,', '"role" text NOT NULL DEFAULT \'member\',')
text = text.replace('"status" USER-DEFINED NOT NULL DEFAULT \'active\'::account_status,', '"status" text NOT NULL DEFAULT \'active\',')
text = text.replace('"presence" USER-DEFINED NOT NULL DEFAULT \'online\'::presence_status,', '"presence" text NOT NULL DEFAULT \'online\',')

# === 2. Fix DEFAULT nextval with ::regclass in CREATE TABLE ===
text = text.replace('"id" integer NOT NULL DEFAULT nextval(\'bar_comments_id_seq\'::regclass)', '"id" integer NOT NULL')
text = text.replace('"id" integer NOT NULL DEFAULT nextval(\'bars_id_seq\'::regclass)', '"id" integer NOT NULL')
text = text.replace('"id" integer NOT NULL DEFAULT nextval(\'cuts_id_seq\'::regclass)', '"id" integer NOT NULL')
text = text.replace('"id" integer NOT NULL DEFAULT nextval(\'histletter_id_seq\'::regclass)', '"id" integer NOT NULL')
text = text.replace('"id" integer NOT NULL DEFAULT nextval(\'logs_id_seq\'::regclass)', '"id" integer NOT NULL')
text = text.replace('"id" integer NOT NULL DEFAULT nextval(\'notext_id_seq\'::regclass)', '"id" integer NOT NULL')
text = text.replace('"idroom" integer NOT NULL DEFAULT nextval(\'rooms_idroom_seq\'::regclass)', '"idroom" integer NOT NULL')
text = text.replace('"idreg" integer DEFAULT nextval(\'users_idreg_seq\'::regclass)', '"idreg" integer')

# === 3. Fix boolean to jsonb in role_permissions ===
text = text.replace("', true, 'legacy_powers');", "', 'true'::jsonb, 'legacy_powers');")

# === 4. Fix site_settings boolean ===
text = text.replace("VALUES ('stories_enabled', true, NULL,", "VALUES ('stories_enabled', 'true'::jsonb, NULL,")

# === 5. Swap role_permissions and roles data sections ===
old_section = """-- Data: role_permissions (22 rows)
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'cp', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'ban', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'kick', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'edituser', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'setpower', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'delmsg', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'delbc', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'flter', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'shrt', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'subs', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'stealth', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'history', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'forcepm', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'grupes', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'createroom', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'roomowner', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'meiut', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'loveu', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'delpic', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'ulike', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'unick', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'publicmsg', 'true'::jsonb, 'legacy_powers');


-- Data: roles (1 rows)
INSERT INTO "roles" ("id", "legacy_name", "name", "rank", "icon_url", "is_system", "auto_enabled", "auto_promote", "auto_points", "legacy_metadata", "created_at", "updated_at") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'ispower', 'Owner', 99999, '', true, false, false, 0, '{}', '2026-06-16T20:07:26.393Z', '2026-06-16T20:07:26.393Z');"""

new_section = """-- Data: roles (1 rows)
INSERT INTO "roles" ("id", "legacy_name", "name", "rank", "icon_url", "is_system", "auto_enabled", "auto_promote", "auto_points", "legacy_metadata", "created_at", "updated_at") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'ispower', 'Owner', 99999, '', true, false, false, 0, '{}', '2026-06-16T20:07:26.393Z', '2026-06-16T20:07:26.393Z');


-- Data: role_permissions (22 rows)
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'cp', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'ban', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'kick', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'edituser', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'setpower', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'delmsg', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'delbc', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'flter', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'shrt', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'subs', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'stealth', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'history', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'forcepm', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'grupes', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'createroom', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'roomowner', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'meiut', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'loveu', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'delpic', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'ulike', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'unick', 'true'::jsonb, 'legacy_powers');
INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source") VALUES ('33311d60-a2cc-44e9-9689-9cce8cd14048', 'publicmsg', 'true'::jsonb, 'legacy_powers');"""

text = text.replace(old_section, new_section)

# === 6. Add SET session_replication_role ===
# Before data section
marker = 'ALTER TABLE "profile_visits" ADD CONSTRAINT "profile_visits_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "users" ("id");\n\n\n-- Data:'
replacement = 'ALTER TABLE "profile_visits" ADD CONSTRAINT "profile_visits_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "users" ("id");\n\nSET session_replication_role = replica;\n\n-- Data:'
text = text.replace(marker, replacement)

# After data, before sequence restarts
seq_marker = '-- Restart sequences\nSELECT setval('
seq_replacement = 'SET session_replication_role = DEFAULT;\n\n-- Restart sequences\nSELECT setval('
text = text.replace(seq_marker, seq_replacement)

# Write back as UTF-8 without BOM
with open('D:\\medo\\hobi\\database_backup_fixed2.sql', 'w', encoding='utf-8') as f:
    f.write(text)

print('Done - file written successfully with UTF-8 encoding')
