import { hashPassword } from './passwords.js';
export async function seed(client, password) {
  if (typeof password !== 'string' || password.startsWith('replace-with-') || password.length < 12 || password.length > 128) throw new Error('Set SEED_PASSWORD to a local-only password of 12–128 characters');
  const passwordHash = await hashPassword(password);
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(40006026)');
    for (const [email, name, role] of [['hr@example.test','Demo HR','HR'],['it@example.test','Demo IT','IT'],['manager@example.test','Demo Manager','Manager']]) {
      await client.query('INSERT INTO app_users(email,display_name,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING', [email,name,passwordHash,role]);
    }
    const manager = (await client.query("SELECT id FROM app_users WHERE email='manager@example.test'")).rows[0].id;
    await client.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date,lifecycle_status,manager_user_id) VALUES ('DEMO-001','Sample Employee','Business Analyst','Consulting','Melbourne','2026-10-19','Onboarding',$1) ON CONFLICT(employee_number) DO NOTHING", [manager]);
    for (const kind of ['Onboarding','Offboarding']) {
      const template = (await client.query('INSERT INTO checklist_templates(name,kind,version) VALUES($1,$2,1) ON CONFLICT(name,version) DO UPDATE SET name=EXCLUDED.name RETURNING id', [`Default ${kind}`,kind])).rows[0].id;
      const tasks = kind === 'Onboarding' ? [['Track account setup','IT'],['Track equipment allocation','IT'],['Complete induction','HR']] : [['Confirm account/access removal','IT'],['Recover equipment','IT'],['Archive employee information','HR']];
      for (let index=0; index<tasks.length; index++) await client.query('INSERT INTO template_tasks(template_id,title,assigned_role,position) VALUES($1,$2,$3,$4) ON CONFLICT(template_id,position) DO NOTHING', [template,...tasks[index],index]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
