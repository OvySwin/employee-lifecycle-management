import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { migrate } from '../src/migrations.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { inTransaction, selectTemplate } from '../src/workflow-start.js';

const origin='http://localhost:5173', password='Offboarding-test-only-2026';
let db,app,employee,manager,template,sessions={};
const path=()=>`/api/employees/${employee}/offboarding`;
const start=(body={end_date:'2026-11-01'},role='HR',target=app)=>request(target).post(path()).set('Origin',origin).set('Cookie',sessions[role].cookie).set('X-CSRF-Token',sessions[role].csrf).send(body);
const read=(role='HR')=>request(app).get(path()).set('Cookie',sessions[role].cookie);
async function stored() {
  return {employee:(await db.query("SELECT lifecycle_status,to_char(end_date,'YYYY-MM-DD') AS end_date FROM employees WHERE id=$1",[employee])).rows[0],
    workflows:(await db.query('SELECT * FROM workflows')).rows,tasks:(await db.query('SELECT * FROM workflow_tasks')).rows};
}
beforeAll(async()=>{
  db=new PGlite(); const query=db.query.bind(db);
  db.query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(results=>results.at(-1)):query(sql,args);
  await migrate(db); await seed(db,password);
  app=createApp(()=>db.query('SELECT 1'),db,{limiter:false});
  const users=(await db.query('SELECT id,email,role FROM app_users')).rows;
  manager=users.find(u=>u.role==='Manager').id;
  for(const user of users){
    const result=await request(app).post('/api/auth/login').set('Origin',origin).send({email:user.email,password});
    sessions[user.role]={cookie:result.headers['set-cookie'][0].split(';')[0],csrf:result.body.csrfToken};
  }
},30000);
beforeEach(async()=>{
  await db.exec('DELETE FROM workflow_tasks; DELETE FROM workflows; DELETE FROM employees; DELETE FROM template_tasks; DELETE FROM checklist_templates;');
  employee=(await db.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date,lifecycle_status,manager_user_id) VALUES('OFF-001','Synthetic Person','Analyst','IT','Melbourne','2026-01-01','Active',$1) RETURNING id",[manager])).rows[0].id;
  template=(await db.query("INSERT INTO checklist_templates(name,kind,version) VALUES('Default Offboarding','Offboarding',1) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO template_tasks(template_id,title,assigned_role,due_offset_days,position) VALUES($1,'Remove access','IT',-1,0),($1,'Recover equipment','IT',0,1),($1,'Archive record','HR',2,2)",[template]);
});
afterAll(async()=>{await db?.close();});

describe('offboarding creation and snapshots',()=>{
  it('creates one workflow and ordered task snapshots, then reads persisted state',async()=>{
    const response=await start();
    expect(response.status).toBe(201);expect(response.headers.location).toBe(path());
    expect(response.body.employee).toEqual({id:employee,end_date:'2026-11-01',lifecycle_status:'Offboarding'});
    expect(response.body.workflow).toMatchObject({employee_id:employee,template_id:template,kind:'Offboarding',status:'InProgress'});
    expect(response.body.tasks.map(t=>[t.title,t.due_date,t.status,t.assignee_user_id])).toEqual([
      ['Remove access','2026-10-31','Pending',null],['Recover equipment','2026-11-01','Pending',null],['Archive record','2026-11-03','Pending',null]
    ]);
    expect((await read()).body).toEqual(response.body);
    expect((await stored()).workflows).toHaveLength(1);
  });
  it('does not change generated snapshots when template text/role/offset changes',async()=>{
    const result=await start();
    await db.query("UPDATE template_tasks SET title='Changed',assigned_role='HR',due_offset_days=7,required=false WHERE template_id=$1",[template]);
    expect((await read()).body.tasks).toEqual(result.body.tasks);
  });
  it('selects matching filters ahead of default and takes highest version at equal specificity',async()=>{
    const chosen=(await db.query("INSERT INTO checklist_templates(name,kind,version,department_filter,location_filter) VALUES('Specific','Offboarding',2,'IT','Melbourne') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO checklist_templates(name,kind,version,department_filter,location_filter) VALUES('Specific','Offboarding',1,'IT','Melbourne'),('Wrong location','Offboarding',9,'IT','Sydney')");
    await db.query("INSERT INTO template_tasks(template_id,title,assigned_role,position) VALUES($1,'Specific task','HR',0)",[chosen]);
    expect((await start()).body.workflow.template_id).toBe(chosen);
  });
  it('permits an end date equal to start and a valid leap date',async()=>{
    expect((await start({end_date:'2026-01-01'})).status).toBe(201);
    await db.exec('DELETE FROM workflow_tasks; DELETE FROM workflows;');
    await db.query("UPDATE employees SET lifecycle_status='Active' WHERE id=$1",[employee]);
    expect((await start({end_date:'2028-02-29'})).status).toBe(201);
  });
  it.each(['Onboarding','Offboarding','Offboarded'])('rejects lifecycle state %s without changes',async state=>{
    await db.query('UPDATE employees SET lifecycle_status=$1 WHERE id=$2',[state,employee]);const before=await stored();
    expect((await start()).status).toBe(409);expect(await stored()).toEqual(before);
  });
  it.each([{},[],{end_date:null},{end_date:'2026-02-30'},{end_date:'0000-01-01'},{end_date:'2026-2-03'},{end_date:123},{end_date:'2026-11-01',lifecycle_status:'Offboarded'}])('rejects invalid body %j without writes',async body=>{
    const before=await stored();expect((await start(body)).status).toBe(400);expect(await stored()).toEqual(before);
  });
  it('rejects an end date before employment start without changes',async()=>{
    const before=await stored(),result=await start({end_date:'2025-12-31'});
    expect(result.status).toBe(400);expect(result.body.fields.end_date).toBeTruthy();expect(await stored()).toEqual(before);
  });
  it('returns 404 for missing employee and 400 for malformed employee ID',async()=>{
    const post=id=>request(app).post(`/api/employees/${id}/offboarding`).set('Origin',origin).set('Cookie',sessions.HR.cookie).set('X-CSRF-Token',sessions.HR.csrf).send({end_date:'2026-11-01'});
    expect((await post(randomUUID())).status).toBe(404);expect((await post('bad-id')).status).toBe(400);
  });
  it('rejects repeat starts and an existing active workflow of either kind',async()=>{
    expect((await start()).status).toBe(201);expect((await start()).status).toBe(409);
    expect((await stored()).workflows).toHaveLength(1);expect((await stored()).tasks).toHaveLength(3);
    await db.exec('DELETE FROM workflow_tasks; DELETE FROM workflows;');
    await db.query("UPDATE employees SET lifecycle_status='Active' WHERE id=$1",[employee]);
    const on=(await db.query("INSERT INTO checklist_templates(name,kind,version) VALUES('Onboarding','Onboarding',1) RETURNING id")).rows[0].id;
    await db.query("INSERT INTO workflows(employee_id,template_id,kind) VALUES($1,$2,'Onboarding')",[employee,on]);
    expect((await start()).status).toBe(409);expect((await stored()).employee.lifecycle_status).toBe('Active');
  });
  it('rejects missing fallback and templates with no required tasks',async()=>{
    await db.query("UPDATE checklist_templates SET location_filter='Sydney'");
    expect((await start()).status).toBe(409);
    await db.query('UPDATE checklist_templates SET location_filter=NULL');
    await db.query('UPDATE template_tasks SET required=false');
    expect((await start()).status).toBe(409);
    await db.query('DELETE FROM template_tasks');expect((await start()).status).toBe(409);
    expect((await stored()).workflows).toHaveLength(0);
  });
  it('rolls back partial tasks and workflow on a database failure, with a generic response',async()=>{
    const failing={query:db.query.bind(db),transaction:action=>db.transaction(tx=>action({query:async(sql,args)=>{
      if(sql.includes('INSERT INTO workflow_tasks')&&args[7]===1) throw new Error('private database credentials');
      return tx.query(sql,args);
    }}))};
    const target=createApp(()=>db.query('SELECT 1'),failing,{limiter:false});const before=await stored();
    const result=await start(undefined,'HR',target);expect(result.status).toBe(500);expect(result.body).toEqual({error:'Request failed'});expect(await stored()).toEqual(before);
  });
  it('rolls back workflow and all tasks when the final employee update fails',async()=>{
    const failing={query:db.query.bind(db),transaction:action=>db.transaction(tx=>action({query:async(sql,args)=>{
      if(sql.startsWith('UPDATE employees'))throw new Error('simulated update failure');return tx.query(sql,args);
    }}))};
    const before=await stored();expect((await start(undefined,'HR',createApp(()=>db.query('SELECT 1'),failing,{limiter:false}))).status).toBe(500);expect(await stored()).toEqual(before);
  });
});
describe('offboarding access control',()=>{
  it('requires a session, configured origin and CSRF token',async()=>{
    expect((await request(app).post(path()).set('Origin',origin).send({end_date:'2026-11-01'})).status).toBe(401);
    expect((await request(app).post(path()).set('Origin',origin).set('Cookie',sessions.HR.cookie).send({end_date:'2026-11-01'})).status).toBe(403);
    expect((await request(app).post(path()).set('Origin','https://evil.test').set('Cookie',sessions.HR.cookie).set('X-CSRF-Token',sessions.HR.csrf).send({end_date:'2026-11-01'})).status).toBe(403);
  });
  it('denies IT and Manager initiation without changes',async()=>{
    const before=await stored();for(const role of ['IT','Manager'])expect((await start(undefined,role)).status).toBe(403);expect(await stored()).toEqual(before);
  });
  it('scopes Manager reads and permits IT when its assigned tasks are present',async()=>{
    expect((await read()).status).toBe(404);await start();
    expect((await read('Manager')).status).toBe(200);expect((await read('IT')).status).toBe(200);
    await db.query('UPDATE employees SET manager_user_id=NULL WHERE id=$1',[employee]);expect((await read('Manager')).status).toBe(404);
    expect((await request(app).get(path())).status).toBe(401);
  });
});
describe('shared workflow primitives',()=>{
  it('matches job title rather than application-user role, uses AND and deterministic ties',()=>{
    const employee={job_title:'Analyst',department:'IT',location:'Melbourne'};
    const make=(id,extra={})=>({id,name:'Default',version:1,role_filter:null,department_filter:null,location_filter:null,...extra});
    expect(selectTemplate([make('b'),make('a')],employee).id).toBe('a');
    expect(selectTemplate([make('fallback'),make('job',{role_filter:'Analyst'}),make('wrong',{role_filter:'HR',version:99})],employee).id).toBe('job');
    expect(selectTemplate([make('fallback'),make('wrong',{department_filter:'IT',location_filter:'Sydney'})],employee).id).toBe('fallback');
  });
  it('leases one pg client for begin/work/commit and releases it',async()=>{
    const client={query:vi.fn().mockResolvedValue({rows:[]}),release:vi.fn()},pool={connect:vi.fn().mockResolvedValue(client),query:vi.fn()};
    expect(await inTransaction(pool,async tx=>{await tx.query('work');return 42;})).toBe(42);
    expect(client.query.mock.calls.map(([sql])=>sql)).toEqual(['BEGIN','work','COMMIT']);expect(pool.query).not.toHaveBeenCalled();expect(client.release).toHaveBeenCalledOnce();
  });
  it('rolls back and releases a pg client on failure',async()=>{
    const client={query:vi.fn().mockResolvedValue({rows:[]}),release:vi.fn()};
    await expect(inTransaction({connect:async()=>client},async()=>{throw new Error('failed');})).rejects.toThrow('failed');
    expect(client.query.mock.calls.map(([sql])=>sql)).toEqual(['BEGIN','ROLLBACK']);expect(client.release).toHaveBeenCalledOnce();
  });
});
