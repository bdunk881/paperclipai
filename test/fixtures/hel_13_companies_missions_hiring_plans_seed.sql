-- HEL-13 sample seed for tests that need a complete canonical company ->
-- mission -> hiring plan chain. Run after migrations.

BEGIN;

INSERT INTO user_profiles (user_id, display_name)
VALUES ('hel-13-seed-user', 'HEL-13 Seed User')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO workspaces (id, name, owner_user_id)
VALUES (
  '13131313-1313-4131-8131-131313131313',
  'HEL-13 Seed Workspace',
  'hel-13-seed-user'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES (
  '13131313-1313-4131-8131-131313131313',
  'hel-13-seed-user',
  'owner'
)
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO companies (id, workspace_id, name, description)
VALUES (
  '13131313-1313-4131-8131-131313131301',
  '13131313-1313-4131-8131-131313131313',
  'Acme Robotics',
  'Sample tenant company for canonical schema tests.'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO missions (id, company_id, statement, status, created_by_user_id)
VALUES (
  '13131313-1313-4131-8131-131313131302',
  '13131313-1313-4131-8131-131313131301',
  'Launch the R-7 robotic arm to North American industrial buyers by Q4.',
  'draft',
  'hel-13-seed-user'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO hiring_plans (id, mission_id, draft)
VALUES (
  '13131313-1313-4131-8131-131313131303',
  '13131313-1313-4131-8131-131313131302',
  '{
    "agents": [
      {
        "name": "Maya Chen",
        "role": "Head of Growth",
        "modelTier": "standard"
      },
      {
        "name": "Theo Brand",
        "role": "Content Strategist",
        "modelTier": "lite"
      }
    ],
    "orgStructure": [
      {
        "manager": "Maya Chen",
        "subagent": "Theo Brand"
      }
    ]
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
