CREATE TABLE roles (name text PRIMARY KEY CHECK (name IN ('HR','IT','Manager')));
INSERT INTO roles VALUES ('HR'),('IT'),('Manager');
CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  password_hash text NOT NULL,
  role text NOT NULL REFERENCES roles(name),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,role)
);
CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_number text NOT NULL UNIQUE,
  full_name text NOT NULL CHECK (length(trim(full_name)) > 0),
  job_title text NOT NULL, department text NOT NULL, location text NOT NULL,
  start_date date NOT NULL, end_date date,
  lifecycle_status text NOT NULL DEFAULT 'Onboarding' CHECK (lifecycle_status IN ('Onboarding','Active','Offboarding','Offboarded')),
  manager_user_id uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX employees_manager ON employees(manager_user_id);
CREATE TABLE checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, kind text NOT NULL CHECK (kind IN ('Onboarding','Offboarding')),
  version integer NOT NULL CHECK (version > 0),
  role_filter text, department_filter text, location_filter text,
  UNIQUE(name,version), UNIQUE(id,kind)
);
CREATE TABLE template_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES checklist_templates(id),
  title text NOT NULL CHECK (length(trim(title)) > 0), required boolean NOT NULL DEFAULT true,
  assigned_role text NOT NULL REFERENCES roles(name), due_offset_days integer NOT NULL DEFAULT 0,
  position integer NOT NULL CHECK (position >= 0), UNIQUE(template_id,position)
);
CREATE TABLE workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  template_id uuid NOT NULL REFERENCES checklist_templates(id),
  kind text NOT NULL CHECK (kind IN ('Onboarding','Offboarding')),
  status text NOT NULL DEFAULT 'InProgress' CHECK (status IN ('InProgress','Completed','Cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  FOREIGN KEY(template_id,kind) REFERENCES checklist_templates(id,kind),
  CHECK ((status = 'Completed') = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_workflow_per_employee ON workflows(employee_id) WHERE status = 'InProgress';
CREATE TABLE workflow_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id),
  source_template_task_id uuid REFERENCES template_tasks(id),
  title text NOT NULL CHECK (length(trim(title)) > 0), required boolean NOT NULL,
  assigned_role text NOT NULL REFERENCES roles(name), assignee_user_id uuid REFERENCES app_users(id),
  due_date date, position integer NOT NULL CHECK (position >= 0),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Completed')),
  completed_at timestamptz, completed_by uuid REFERENCES app_users(id),
  UNIQUE(workflow_id,position),
  FOREIGN KEY(assignee_user_id,assigned_role) REFERENCES app_users(id,role),
  CHECK ((status = 'Completed') = (completed_at IS NOT NULL AND completed_by IS NOT NULL)),
  CHECK (status = 'Completed' OR (completed_at IS NULL AND completed_by IS NULL))
);
CREATE INDEX tasks_assignee ON workflow_tasks(assignee_user_id);
CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  csrf_hash text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_expiry ON auth_sessions(expires_at);
