import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../src/migrations.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/passwords.js';
const password = 'Test-only-password-2026';
const origin = 'http://localhost:5173';
let db, app, otherEmployee, manager, hr, workflow, otherTask;
async function login(email='hr@example.test', target=app) {
  const response = await request(target).post('/api/auth/login').set('Origin',origin).send({email,password});
  expect(response.status).toBe(200);
  return { cookie:response.headers['set-cookie'][0].split(';')[0], csrf:response.body.csrfToken,response };
}
beforeAll(async () => {
  db = new PGlite();
  const query = db.query.bind(db);
  db.query = (sql,values) => !values && sql.includes(';') ? db.exec(sql).then(results=>results.at(-1)) : query(sql,values);
  await migrate(db);
  await seed(db,password);
  app = createApp(()=>db.query('SELECT 1'),db,{limiter:false});
  manager=(await db.query("SELECT id FROM app_users WHERE role='Manager'")).rows[0].id;
  hr=(await db.query("SELECT id FROM app_users WHERE role='HR'")).rows[0].id;
  otherEmployee=(await db.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date) VALUES('OTHER','Other Employee','Analyst','IT','Sydney','2026-10-19') RETURNING id")).rows[0].id;
  const template=(await db.query("SELECT id FROM checklist_templates WHERE kind='Onboarding'")).rows[0].id;
  workflow=(await db.query("INSERT INTO workflows(employee_id,template_id,kind) VALUES($1,$2,'Onboarding') RETURNING id",[otherEmployee,template])).rows[0].id;
  otherTask=(await db.query("INSERT INTO workflow_tasks(workflow_id,title,required,assigned_role,assignee_user_id,position) VALUES($1,'Private HR Task',true,'HR',$2,0) RETURNING id",[workflow,hr])).rows[0].id;
},30000);
afterAll(async()=>{ await db?.close(); });
describe('database foundations (embedded PostgreSQL)',()=>{
  it('reruns migrations and seeds without duplicate data or password reset',async()=>{
    const before=(await db.query("SELECT password_hash FROM app_users WHERE role='HR'")).rows[0].password_hash;
    await migrate(db); await seed(db,'Different-local-password');
    expect((await db.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count).toBe(1);
    expect((await db.query('SELECT count(*)::int AS count FROM app_users')).rows[0].count).toBe(3);
    expect((await db.query('SELECT count(*)::int AS count FROM template_tasks')).rows[0].count).toBe(14);
    expect((await db.query("SELECT title,assigned_role FROM template_tasks t JOIN checklist_templates c ON c.id=t.template_id WHERE c.kind='Onboarding' ORDER BY position")).rows).toEqual([
      {title:'Track account setup',assigned_role:'IT'},
      {title:'Track equipment allocation',assigned_role:'IT'},
      {title:'Complete induction',assigned_role:'HR'},
      {title:'Send welcome email',assigned_role:'HR'},
      {title:'Verify work eligibility documents',assigned_role:'HR'},
      {title:'Schedule orientation',assigned_role:'HR'},
      {title:'Collect signed policy acknowledgements',assigned_role:'HR'},
      {title:'Set up workstation and equipment',assigned_role:'IT'},
      {title:'Provision email and application access',assigned_role:'IT'},
      {title:'Configure building access',assigned_role:'IT'},
      {title:'Complete security awareness setup',assigned_role:'IT'}
    ]);
    expect((await db.query("SELECT password_hash FROM app_users WHERE role='HR'")).rows[0].password_hash).toBe(before);
  });
  it('rejects invalid lifecycle states, dates and foreign keys',async()=>{
    await expect(db.query("UPDATE employees SET lifecycle_status='Invalid' WHERE id=$1",[otherEmployee])).rejects.toMatchObject({code:'23514'});
    await expect(db.query("UPDATE employees SET end_date='2020-01-01' WHERE id=$1",[otherEmployee])).rejects.toMatchObject({code:'23514'});
    await expect(db.query('UPDATE employees SET manager_user_id=$1 WHERE id=$2',[randomUUID(),otherEmployee])).rejects.toMatchObject({code:'23503'});
  });
  it('prevents a second active workflow and permits history after completion',async()=>{
    const template=(await db.query('SELECT template_id FROM workflows WHERE id=$1',[workflow])).rows[0].template_id;
    await expect(db.query("INSERT INTO workflows(employee_id,template_id,kind) VALUES($1,$2,'Onboarding')",[otherEmployee,template])).rejects.toMatchObject({code:'23505'});
    await db.query("UPDATE workflows SET status='Completed',completed_at=now() WHERE id=$1",[workflow]);
    const offboarding=(await db.query("SELECT id FROM checklist_templates WHERE kind='Offboarding'")).rows[0].id;
    await db.query("INSERT INTO workflows(employee_id,template_id,kind) VALUES($1,$2,'Offboarding')",[otherEmployee,offboarding]);
  });
  it('preserves generated task snapshots when template changes',async()=>{
    await db.query("UPDATE template_tasks SET title='Changed template title' WHERE position=0");
    expect((await db.query('SELECT title FROM workflow_tasks WHERE id=$1',[otherTask])).rows[0].title).toBe('Private HR Task');
  });
  it('rejects incomplete completion metadata and rolls back failed transactions',async()=>{
    await expect(db.query("UPDATE workflow_tasks SET status='Completed' WHERE id=$1",[otherTask])).rejects.toMatchObject({code:'23514'});
    await db.query('BEGIN');
    try {
      await db.query("UPDATE employees SET full_name='Rollback name' WHERE id=$1",[otherEmployee]);
      await db.query("UPDATE employees SET lifecycle_status='Invalid' WHERE id=$1",[otherEmployee]);
    } catch { await db.query('ROLLBACK'); }
    expect((await db.query('SELECT full_name FROM employees WHERE id=$1',[otherEmployee])).rows[0].full_name).toBe('Other Employee');
  });
});
describe('sessions, CSRF and role scope',()=>{
  it('rejects unauthenticated access and returns generic credential failures',async()=>{
    expect((await request(app).get('/api/employees')).status).toBe(401);
    const wrong=await request(app).post('/api/auth/login').set('Origin',origin).send({email:'hr@example.test',password:'incorrect'});
    const missing=await request(app).post('/api/auth/login').set('Origin',origin).send({email:'unknown@example.test',password:'incorrect'});
    expect(wrong.status).toBe(401); expect(missing.status).toBe(401); expect(wrong.body).toEqual(missing.body);
  });
  it('creates HttpOnly/SameSite cookie and never returns password or session token in JSON',async()=>{
    const {cookie,response}=await login();
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(response.text).not.toContain(cookie.split('=')[1]);
    expect(response.text).not.toContain('password_hash');
    expect((await request(app).get('/api/auth/me').set('Cookie',cookie)).body.user.role).toBe('HR');
  });
  it('HR sees employees; manager sees only managed employee; IT is denied employee listing',async()=>{
    const a=await login(), b=await login('manager@example.test'), c=await login('it@example.test');
    expect((await request(app).get('/api/employees').set('Cookie',a.cookie)).body.employees).toHaveLength(2);
    const managed=(await request(app).get('/api/employees').set('Cookie',b.cookie)).body.employees;
    expect(managed).toHaveLength(1); expect(managed[0].employee_number).toBe('DEMO-001');
    expect((await request(app).get('/api/employees').set('Cookie',c.cookie)).status).toBe(403);
  });
  it('IT and manager cannot read a task assigned to another user',async()=>{
    for (const email of ['it@example.test','manager@example.test']) {
      const {cookie}=await login(email);
      expect((await request(app).get('/api/tasks').set('Cookie',cookie)).body.tasks).toHaveLength(0);
    }
  });
  it('only returns assigned tasks matching the user role',async()=>{
    const template=(await db.query('SELECT id FROM workflows WHERE employee_id=$1 AND status=\'InProgress\'',[otherEmployee])).rows[0].id;
    await db.query("INSERT INTO workflow_tasks(workflow_id,title,required,assigned_role,assignee_user_id,position) VALUES($1,'Manager Task',true,'Manager',$2,1)",[template,manager]);
    const {cookie}=await login('manager@example.test');
    expect((await request(app).get('/api/tasks').set('Cookie',cookie)).body.tasks.map(task=>task.title)).toEqual(['Manager Task']);
  });
  it('rejects cross-origin login and invalid/missing CSRF on logout',async()=>{
    expect((await request(app).post('/api/auth/login').set('Origin','https://evil.test').send({email:'hr@example.test',password})).status).toBe(403);
    const {cookie,csrf}=await login();
    expect((await request(app).post('/api/auth/logout').set('Origin',origin).set('Cookie',cookie)).status).toBe(403);
    expect((await request(app).post('/api/auth/logout').set('Origin',origin).set('Cookie',cookie).set('X-CSRF-Token','0'.repeat(64))).status).toBe(403);
    expect((await request(app).post('/api/auth/logout').set('Origin',origin).set('Cookie',cookie).set('X-CSRF-Token',csrf)).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Cookie',cookie)).status).toBe(401);
  });
  it('expires sessions and invalidates disabled users',async()=>{
    const {cookie}=await login();
    await db.query("UPDATE auth_sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1",[hr]);
    expect((await request(app).get('/api/auth/me').set('Cookie',cookie)).status).toBe(401);
    const next=await login(); await db.query('UPDATE app_users SET enabled=false WHERE id=$1',[hr]);
    expect((await request(app).get('/api/auth/me').set('Cookie',next.cookie)).status).toBe(401);
    await db.query('UPDATE app_users SET enabled=true WHERE id=$1',[hr]);
  });
  it('rotates prior session on login',async()=>{
    const first=await login();
    const second=await request(app).post('/api/auth/login').set('Origin',origin).set('Cookie',first.cookie).send({email:'hr@example.test',password});
    expect(second.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie',first.cookie)).status).toBe(401);
  });
  it('sets Secure cookies in production-mode configuration',async()=>{
    const secureApp=createApp(()=>db.query('SELECT 1'),db,{origin,secure:true,limiter:false});
    const {response}=await login('hr@example.test',secureApp);
    expect(response.headers['set-cookie'][0]).toContain('__Host-elm_session=');
    expect(response.headers['set-cookie'][0]).toContain('; Secure');
  });
  it('rate-limits repeated login failures',async()=>{
    const limitedApp=createApp(()=>db.query('SELECT 1'),db,{origin});
    for(let index=0;index<20;index++) await request(limitedApp).post('/api/auth/login').set('Origin',origin).send({email:'x@example.test',password:'x'});
    expect((await request(limitedApp).post('/api/auth/login').set('Origin',origin).send({email:'x@example.test',password:'x'})).status).toBe(429);
  },10000);
  it('stores scrypt hashes with random salts',async()=>{
    const a=await hashPassword(password),b=await hashPassword(password);
    expect(a).not.toBe(b); expect(a).not.toContain(password);
  });
});
