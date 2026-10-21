import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { migrate } from '../src/migrations.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

const origin='http://localhost:5173',password='Onboarding-test-password-2026';
let db,app,sessions={},manager,employee,other;
const path=()=>`/api/employees/${employee}/onboarding`;
const start=(role='HR',target=app)=>request(target).post(path()).set('Origin',origin).set('Cookie',sessions[role].cookie).set('X-CSRF-Token',sessions[role].csrf);
const approve=(id,role='HR',target=app)=>request(target).post(`/api/onboarding-tasks/${id}/approve`).set('Origin',origin).set('Cookie',sessions[role].cookie).set('X-CSRF-Token',sessions[role].csrf);
const read=(target=path(),role='HR')=>request(app).get(target).set('Cookie',sessions[role].cookie);
async function stored() {
  return {workflows:(await db.query('SELECT * FROM workflows')).rows,tasks:(await db.query('SELECT * FROM workflow_tasks')).rows};
}

beforeAll(async()=>{
  db=new PGlite();const query=db.query.bind(db);
  db.query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(results=>results.at(-1)):query(sql,args);
  await migrate(db);await seed(db,password);
  app=createApp(()=>db.query('SELECT 1'),db,{limiter:false});
  const users=(await db.query('SELECT id,email,role FROM app_users')).rows;
  manager=users.find(user=>user.role==='Manager').id;
  for(const user of users){
    const response=await request(app).post('/api/auth/login').set('Origin',origin).send({email:user.email,password});
    sessions[user.role]={cookie:response.headers['set-cookie'][0].split(';')[0],csrf:response.body.csrfToken};
  }
},30000);

beforeEach(async()=>{
  await db.exec('DELETE FROM workflow_tasks; DELETE FROM workflows; DELETE FROM employees; DELETE FROM template_tasks; DELETE FROM checklist_templates;');
  employee=(await db.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date,lifecycle_status,manager_user_id) VALUES('ON-001','Onboarding Person','Analyst','IT','Melbourne','2026-10-19','Onboarding',$1) RETURNING id",[manager])).rows[0].id;
  other=(await db.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date,lifecycle_status) VALUES('ON-002','Unassigned Person','Coordinator','HR','Sydney','2026-11-01','Onboarding') RETURNING id")).rows[0].id;
  const template=(await db.query("INSERT INTO checklist_templates(name,kind,version) VALUES('Default Onboarding','Onboarding',1) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO template_tasks(template_id,title,assigned_role,due_offset_days,position) VALUES($1,'Create account','IT',0,0),($1,'Prepare equipment','IT',2,1),($1,'Complete induction','HR',7,2)",[template]);
});
afterAll(async()=>{await db?.close();});

describe('onboarding checklist generation',()=>{
  it('starts onboarding once, stores ordered task snapshots and serves the checklist',async()=>{
    const response=await start();
    expect(response.status).toBe(201);expect(response.headers.location).toBe(path());
    expect(response.body.employee).toEqual({id:employee,lifecycle_status:'Onboarding'});
    expect(response.body.workflow).toMatchObject({employee_id:employee,kind:'Onboarding',status:'InProgress'});
    expect(response.body.tasks.map(task=>[task.title,task.assigned_role,task.due_date,task.status])).toEqual([
      ['Create account','IT','2026-10-19','Pending'],['Prepare equipment','IT','2026-10-21','Pending'],['Complete induction','HR','2026-10-26','Pending']
    ]);
    const persisted=(await read()).body;
    expect(persisted.workflow).toEqual(response.body.workflow);
    expect(persisted.tasks).toEqual(response.body.tasks);
    expect((await start()).status).toBe(409);
    expect((await stored()).workflows).toHaveLength(1);
  });

  it('uses the most specific applicable template and preserves task snapshots',async()=>{
    const specific=(await db.query("INSERT INTO checklist_templates(name,kind,version,department_filter,location_filter) VALUES('IT Melbourne','Onboarding',2,'IT','Melbourne') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO template_tasks(template_id,title,assigned_role,due_offset_days,position) VALUES($1,'Specific setup','IT',1,0)",[specific]);
    const response=await start();
    expect(response.body.workflow.template_id).toBe(specific);
    expect(response.body.tasks.map(task=>task.title)).toEqual(['Specific setup']);
    await db.query("UPDATE template_tasks SET title='Changed later',due_offset_days=30 WHERE template_id=$1",[specific]);
    expect((await read()).body.tasks).toEqual(response.body.tasks);
  });

  it.each(['Active','Offboarding','Offboarded'])('rejects start for %s employees without writes',async status=>{
    await db.query('UPDATE employees SET lifecycle_status=$1 WHERE id=$2',[status,employee]);
    const before=await stored();
    expect((await start()).status).toBe(409);
    expect(await stored()).toEqual(before);
  });

  it('rejects missing templates and templates without required tasks',async()=>{
    await db.query('DELETE FROM template_tasks;');
    expect((await start()).status).toBe(409);
    await db.query("INSERT INTO template_tasks(template_id,title,assigned_role,required,position) SELECT id,'Optional','IT',false,0 FROM checklist_templates WHERE kind='Onboarding'");
    expect((await start()).status).toBe(409);
    expect((await stored()).workflows).toHaveLength(0);
  });

  it('rejects invalid IDs, request bodies and missing employees',async()=>{
    expect((await request(app).post('/api/employees/not-a-uuid/onboarding').set('Origin',origin).set('Cookie',sessions.HR.cookie).set('X-CSRF-Token',sessions.HR.csrf)).status).toBe(400);
    expect((await request(app).post(`/api/employees/${randomUUID()}/onboarding`).set('Origin',origin).set('Cookie',sessions.HR.cookie).set('X-CSRF-Token',sessions.HR.csrf)).status).toBe(404);
    expect((await start().send({unexpected:true})).status).toBe(400);
    expect((await stored()).workflows).toHaveLength(0);
  });

  it('rolls back the workflow and partial task snapshots on database failure',async()=>{
    const failing={query:db.query.bind(db),transaction:action=>db.transaction(tx=>action({query:async(sql,args)=>{
      if(sql.includes('INSERT INTO workflow_tasks')&&args[7]===1)throw new Error('simulated task failure');
      return tx.query(sql,args);
    }}))};
    const target=createApp(()=>db.query('SELECT 1'),failing,{limiter:false});
    expect((await start('HR',target)).status).toBe(500);
    expect(await stored()).toEqual({workflows:[],tasks:[]});
  });

  it('allows HR and IT to approve only pending steps assigned to their role',async()=>{
    const checklist=(await start()).body;
    const itTask=checklist.tasks.find(task=>task.assigned_role==='IT');
    const hrTask=checklist.tasks.find(task=>task.assigned_role==='HR');
    expect((await approve(itTask.id,'Manager')).status).toBe(403);
    expect((await approve(itTask.id,'HR')).status).toBe(403);
    const itApproval=await approve(itTask.id,'IT');
    expect(itApproval.status).toBe(200);
    expect(itApproval.body.task).toMatchObject({id:itTask.id,status:'Completed'});
    expect(itApproval.body.workflow.status).toBe('InProgress');
    expect((await approve(itTask.id,'IT')).status).toBe(409);
    expect((await approve(hrTask.id,'IT')).status).toBe(403);
    const hrApproval=await approve(hrTask.id,'HR');
    expect(hrApproval.body.task.status).toBe('Completed');
    expect(hrApproval.body.workflow.status).toBe('InProgress');
    expect((await db.query('SELECT lifecycle_status FROM employees WHERE id=$1',[employee])).rows[0].lifecycle_status).toBe('Onboarding');
    const remainingItTask=checklist.tasks.filter(task=>task.assigned_role==='IT'&&task.id!==itTask.id)[0];
    const finalApproval=await approve(remainingItTask.id,'IT');
    expect(finalApproval.status).toBe(200);
    expect(finalApproval.body.workflow.status).toBe('Completed');
    expect(finalApproval.body.employee).toEqual({id:employee,lifecycle_status:'Active'});
    const current=(await read()).body.tasks;
    expect(current.find(task=>task.id===itTask.id).status).toBe('Completed');
    expect(current.find(task=>task.id===hrTask.id).status).toBe('Completed');
    expect(current.every(task=>task.status==='Completed')).toBe(true);
    expect((await db.query("SELECT status,completed_at FROM workflows WHERE employee_id=$1 AND kind='Onboarding'",[employee])).rows[0]).toMatchObject({status:'Completed',completed_at:expect.anything()});
    expect((await db.query('SELECT count(*)::int AS count FROM workflow_tasks WHERE status=$1 AND completed_by IS NOT NULL',['Completed'])).rows[0].count).toBe(3);
    expect((await db.query('SELECT lifecycle_status FROM employees WHERE id=$1',[employee])).rows[0].lifecycle_status).toBe('Active');
  });

  it('rejects invalid and unknown onboarding task IDs',async()=>{
    expect((await approve('bad-id')).status).toBe(400);
    expect((await approve(randomUUID())).status).toBe(404);
    expect((await request(app).post('/api/onboarding-tasks/not-a-uuid/approve').set('Origin',origin)).status).toBe(401);
  });
});

describe('onboarding checklist permissions',()=>{
  it('allows only HR to start and requires valid session, origin and CSRF',async()=>{
    expect((await request(app).post(path()).set('Origin',origin)).status).toBe(401);
    expect((await request(app).post(path()).set('Origin',origin).set('Cookie',sessions.HR.cookie)).status).toBe(403);
    expect((await request(app).post(path()).set('Origin','https://evil.test').set('Cookie',sessions.HR.cookie).set('X-CSRF-Token',sessions.HR.csrf)).status).toBe(403);
    for(const role of ['Manager','IT'])expect((await start(role)).status).toBe(403);
    expect((await stored()).workflows).toHaveLength(0);
  });

  it('shows the full checklist to HR, the assigned manager and IT with authorised employee scope',async()=>{
    await start();
    const checklistPath=path();
    for(const role of ['HR','Manager','IT']){
      const result=await read(checklistPath,role);
      expect(result.status).toBe(200);
      expect(result.body.tasks.map(task=>task.title)).toEqual(['Create account','Prepare equipment','Complete induction']);
    }
    expect((await read(`/api/employees/${other}/onboarding`,'Manager')).status).toBe(404);
    expect((await read(`/api/employees/${other}/onboarding`,'IT')).status).toBe(404);
    const all=(await read('/api/onboarding-checklists','HR')).body.checklists;
    expect(all).toHaveLength(1);
    expect((await read('/api/onboarding-checklists','Manager')).body.checklists).toHaveLength(1);
    expect((await read('/api/onboarding-checklists','IT')).body.checklists[0].tasks).toHaveLength(3);
    expect((await request(app).get('/api/onboarding-checklists')).status).toBe(401);
  });
});
