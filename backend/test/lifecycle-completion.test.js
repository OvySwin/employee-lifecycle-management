import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import request from 'supertest';
import { migrate } from '../src/migrations.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

const origin='http://localhost:5173', password='Lifecycle-completion-test-2026';
let db, app, sessions, employee, manager;
const authenticated=(role)=>({Cookie:sessions[role].cookie,'X-CSRF-Token':sessions[role].csrf,Origin:origin});
beforeAll(async()=>{
  db=new PGlite();
  const query=db.query.bind(db);
  db.query=(sql,values)=>!values&&sql.includes(';')?db.exec(sql).then(a=>a.at(-1)):query(sql,values);
  await migrate(db);await seed(db,password);
  app=createApp(()=>db.query('SELECT 1'),db,{limiter:false});
  sessions={};
  for(const user of (await db.query('SELECT email,role,id FROM app_users')).rows){
    if(user.role==='Manager')manager=user.id;
    const login=await request(app).post('/api/auth/login').set('Origin',origin).send({email:user.email,password});
    sessions[user.role]={cookie:login.headers['set-cookie'][0].split(';')[0],csrf:login.body.csrfToken,id:user.id};
  }
},30000);
beforeEach(async()=>{
  await db.exec('DELETE FROM workflow_tasks;DELETE FROM workflows;DELETE FROM employees;DELETE FROM template_tasks;DELETE FROM checklist_templates;');
  employee=(await db.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date,lifecycle_status,manager_user_id) VALUES('TEST-1','Synthetic User','Analyst','IT','Melbourne','2026-01-01','Active',$1) RETURNING id",[manager])).rows[0].id;
});
afterAll(async()=>db?.close());

describe('offboarding completion',()=>{
  it('completes required role-queue tasks atomically and marks employee Offboarded',async()=>{
    const template=(await db.query("INSERT INTO checklist_templates(name,kind,version) VALUES('Offboarding','Offboarding',1) RETURNING id")).rows[0].id;
    await db.query("INSERT INTO template_tasks(template_id,title,assigned_role,required,position) VALUES($1,'Remove access','IT',true,0),($1,'Recover equipment','HR',true,1),($1,'Optional goodbye','HR',false,2)",[template]);
    const started=await request(app).post('/api/employees/'+employee+'/offboarding').set(authenticated('HR')).send({end_date:'2026-10-30'});
    expect(started.status).toBe(201);
    const [itTask,hrTask]=started.body.tasks;
    const deny=await request(app).post('/api/offboarding-tasks/'+itTask.id+'/approve').set(authenticated('HR'));
    expect(deny.status).toBe(403);
    const first=await request(app).post('/api/offboarding-tasks/'+itTask.id+'/approve').set(authenticated('IT'));
    expect(first.status).toBe(200);expect(first.body.workflow.status).toBe('InProgress');
    const second=await request(app).post('/api/offboarding-tasks/'+hrTask.id+'/approve').set(authenticated('HR'));
    expect(second.status).toBe(200);
    expect(second.body.employee.lifecycle_status).toBe('Offboarded');
    expect(second.body.workflow.status).toBe('Completed');
    expect((await request(app).post('/api/offboarding-tasks/'+hrTask.id+'/approve').set(authenticated('HR'))).status).toBe(409);
  });
  it('returns a role-scoped dashboard and allows HR task assignment only to the correct role',async()=>{
    const template=(await db.query("INSERT INTO checklist_templates(name,kind,version) VALUES('Default Offboarding','Offboarding',1) RETURNING id")).rows[0].id;
    await db.query("INSERT INTO template_tasks(template_id,title,assigned_role,position) VALUES($1,'Remove access','IT',0)",[template]);
    const started=await request(app).post('/api/employees/'+employee+'/offboarding').set(authenticated('HR')).send({end_date:'2026-10-30'});
    expect(started.status).toBe(201);
    const task=started.body.tasks[0];
    expect((await request(app).get('/api/overview').set('Cookie',sessions.IT.cookie)).body.tasks.map(t=>t.id)).toContain(task.id);
    expect((await request(app).patch('/api/workflow-tasks/'+task.id+'/assignee').set(authenticated('IT')).send({assignee_user_id:sessions.IT.id})).status).toBe(403);
    expect((await request(app).patch('/api/workflow-tasks/'+task.id+'/assignee').set(authenticated('HR')).send({assignee_user_id:sessions.HR.id})).status).toBe(400);
    const assignment=await request(app).patch('/api/workflow-tasks/'+task.id+'/assignee').set(authenticated('HR')).send({assignee_user_id:sessions.IT.id});
    expect(assignment.status,JSON.stringify({response:assignment.body,user:sessions.IT.id,task:task.id})).toBe(200);
  });
});
