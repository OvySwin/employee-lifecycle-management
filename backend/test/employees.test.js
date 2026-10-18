import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { migrate } from '../src/migrations.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

const origin='http://localhost:5173',password='Employee-test-password-2026';
const valid={employee_number:'NEW-001',full_name:'New Person',job_title:'Business Analyst',department:'Consulting',location:'Melbourne',start_date:'2026-10-19',end_date:null,manager_user_id:null};
let db,app,sessions={},manager,hr,own,other;
async function write(method,path,body,role='HR') {
  return request(app)[method](path).set('Origin',origin).set('Cookie',sessions[role].cookie).set('X-CSRF-Token',sessions[role].csrf).send(body);
}
function read(path,role='HR') { return request(app).get(path).set('Cookie',sessions[role].cookie); }
beforeAll(async()=>{
  db=new PGlite();const query=db.query.bind(db);
  db.query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(results=>results.at(-1)):query(sql,args);
  await migrate(db);await seed(db,password);
  app=createApp(()=>db.query('SELECT 1'),db,{limiter:false});
  const users=(await db.query('SELECT id,email,role FROM app_users')).rows;
  for(const user of users){
    const response=await request(app).post('/api/auth/login').set('Origin',origin).send({email:user.email,password});
    sessions[user.role]={cookie:response.headers['set-cookie'][0].split(';')[0],csrf:response.body.csrfToken};
  }
  manager=users.find(user=>user.role==='Manager').id;hr=users.find(user=>user.role==='HR').id;
},30000);
beforeEach(async()=>{
  await db.query('DELETE FROM employees');
  own=(await db.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date,manager_user_id) VALUES('BASE-001','Assigned Person','Analyst','IT','Melbourne','2026-10-19',$1) RETURNING id",[manager])).rows[0].id;
  other=(await db.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date) VALUES('BASE-002','Other Person','Analyst','IT','Sydney','2026-10-19') RETURNING id")).rows[0].id;
});
afterAll(async()=>{await db?.close();});
describe('employee create and edit',()=>{
  it('creates and reads back an employee with initial Onboarding status',async()=>{
    const result=await write('post','/api/employees',{...valid,manager_user_id:manager});
    expect(result.status).toBe(201);expect(result.headers.location).toBe(`/api/employees/${result.body.employee.id}`);
    expect(result.body.employee).toMatchObject({...valid,manager_user_id:manager,lifecycle_status:'Onboarding'});
    expect((await read(result.headers.location)).body.employee).toEqual(result.body.employee);
    expect((await db.query('SELECT full_name FROM employees WHERE id=$1',[result.body.employee.id])).rows[0].full_name).toBe(valid.full_name);
  });
  it('trims fields, normalises the employee number and permits a leap date',async()=>{
    const result=await write('post','/api/employees',{...valid,employee_number:' new-002 ',full_name:' Person ',start_date:'2028-02-29'});
    expect(result.status).toBe(201);expect(result.body.employee.employee_number).toBe('NEW-002');expect(result.body.employee.full_name).toBe('Person');expect(result.body.employee.start_date).toBe('2028-02-29');
  });
  it('returns 409 for an existing employee number',async()=>{
    const result=await write('post','/api/employees',{...valid,employee_number:' base-001 '});
    expect(result.status).toBe(409);expect(result.body.fields.employee_number).toBeTruthy();
    expect((await db.query('SELECT count(*)::int AS count FROM employees')).rows[0].count).toBe(2);
  });
  it('partially edits a record and retains unmodified fields and status',async()=>{
    await db.query("UPDATE employees SET lifecycle_status='Active' WHERE id=$1",[own]);
    const result=await write('patch',`/api/employees/${own}`,{job_title:'Senior Analyst',location:'Perth',end_date:'2026-11-01'});
    expect(result.status).toBe(200);expect(result.body.employee).toMatchObject({full_name:'Assigned Person',job_title:'Senior Analyst',location:'Perth',lifecycle_status:'Active',end_date:'2026-11-01'});
    expect((await read(`/api/employees/${own}`)).body.employee.job_title).toBe('Senior Analyst');
  });
  it('allows clearing optional end date and manager',async()=>{
    await write('patch',`/api/employees/${own}`,{end_date:'2026-11-01'});
    const result=await write('patch',`/api/employees/${own}`,{end_date:null,manager_user_id:null});
    expect(result.status).toBe(200);expect(result.body.employee.end_date).toBeNull();expect(result.body.employee.manager_user_id).toBeNull();
  });
  it.each(['2026-02-30','2026-02-29','0000-01-01','2026-2-03'])('rejects an invalid date %s',async date=>{
    const result=await write('post','/api/employees',{...valid,start_date:date});
    expect(result.status).toBe(400);expect(result.body.fields.start_date).toBeTruthy();
  });
  it('rejects invalid date ranges for create and partial update',async()=>{
    expect((await write('post','/api/employees',{...valid,end_date:'2026-10-18'})).status).toBe(400);
    await write('patch',`/api/employees/${own}`,{end_date:'2026-11-01'});
    const result=await write('patch',`/api/employees/${own}`,{start_date:'2026-12-01'});
    expect(result.status).toBe(400);expect(result.body.fields.end_date).toBeTruthy();
    expect((await read(`/api/employees/${own}`)).body.employee.start_date).toBe('2026-10-19');
  });
  it('rejects blank/overlong fields, wrong types and unsupported body shapes',async()=>{
    const result=await write('post','/api/employees',{...valid,full_name:'  ',job_title:'x'.repeat(121),location:42,employee_number:'bad number!'});
    expect(result.status).toBe(400);expect(Object.keys(result.body.fields)).toEqual(expect.arrayContaining(['full_name','job_title','location','employee_number']));
    expect((await write('post','/api/employees',[])).status).toBe(400);
    expect((await write('patch',`/api/employees/${own}`,{})).status).toBe(400);
  });
  it('rejects mass assignment of lifecycle status, IDs and password fields',async()=>{
    for(const extra of [{lifecycle_status:'Active'},{id:randomUUID()},{password_hash:'not-allowed'},JSON.parse('{"__proto__":{}}')]) expect((await write('post','/api/employees',{...valid,...extra})).status).toBe(400);
    expect((await write('patch',`/api/employees/${own}`,{lifecycle_status:'Offboarded'})).status).toBe(400);
    expect((await write('patch',`/api/employees/${own}`,{employee_number:'CHANGED'})).status).toBe(400);
    expect((await read(`/api/employees/${own}`)).body.employee.lifecycle_status).toBe('Onboarding');
  });
  it('validates manager assignment against role, enabled status and existence',async()=>{
    for(const id of [hr,randomUUID(),'invalid']){
      const result=await write('post','/api/employees',{...valid,manager_user_id:id});
      expect(result.status).toBe(400);expect(result.body.fields.manager_user_id).toBeTruthy();
    }
    await db.query('UPDATE app_users SET enabled=false WHERE id=$1',[manager]);
    expect((await write('post','/api/employees',{...valid,manager_user_id:manager})).status).toBe(400);
    await db.query('UPDATE app_users SET enabled=true WHERE id=$1',[manager]);
  });
});
describe('permissions and pagination',()=>{
  it('rejects unauthenticated reads/writes and CSRF-less changes',async()=>{
    expect((await request(app).get('/api/employees')).status).toBe(401);
    expect((await request(app).post('/api/employees').set('Origin',origin).send(valid)).status).toBe(401);
    expect((await request(app).post('/api/employees').set('Origin',origin).set('Cookie',sessions.HR.cookie).send(valid)).status).toBe(403);
    expect((await request(app).post('/api/employees').set('Origin','https://evil.test').set('Cookie',sessions.HR.cookie).set('X-CSRF-Token',sessions.HR.csrf).send(valid)).status).toBe(403);
  });
  it('allows manager scoped reads but rejects manager and IT writes',async()=>{
    expect((await read(`/api/employees/${own}`,'Manager')).status).toBe(200);
    expect((await read(`/api/employees/${other}`,'Manager')).status).toBe(404);
    for(const role of ['Manager','IT']){
      expect((await write('post','/api/employees',valid,role)).status).toBe(403);
      expect((await write('patch',`/api/employees/${own}`,{full_name:'Forbidden'},role)).status).toBe(403);
      expect((await read('/api/employee-managers',role)).status).toBe(403);
    }
    expect((await read(`/api/employees/${own}`,'IT')).status).toBe(403);
    expect((await read('/api/employees','IT')).status).toBe(403);
    expect((await read(`/api/employees/${own}`)).body.employee.full_name).toBe('Assigned Person');
  });
  it('limits pagination records and totals to the manager scope',async()=>{
    const first=await read('/api/employees?page=1&pageSize=1');
    const second=await read('/api/employees?page=2&pageSize=1');
    expect(first.body.pagination).toEqual({page:1,pageSize:1,total:2,totalPages:2});
    expect(first.body.employees[0].id).not.toBe(second.body.employees[0].id);
    const scoped=await read('/api/employees?page=1&pageSize=1','Manager');
    expect(scoped.body.pagination.total).toBe(1);expect(scoped.body.employees[0].id).toBe(own);
    expect((await read('/api/employees?page=3&pageSize=1')).body.employees).toEqual([]);
  });
  it.each(['page=0','page=-1','page=1.5','page=100001','pageSize=101','pageSize=nope','page=1&page=2'])('rejects invalid pagination %s',async query=>{
    expect((await read(`/api/employees?${query}`)).status).toBe(400);
  });
  it('returns clear invalid-ID and not-found responses',async()=>{
    expect((await read('/api/employees/not-a-uuid')).status).toBe(400);
    expect((await read(`/api/employees/${randomUUID()}`)).status).toBe(404);
    expect((await write('patch',`/api/employees/${randomUUID()}`,{full_name:'Missing'})).status).toBe(404);
    expect((await write('patch','/api/employees/not-a-uuid',{full_name:'Invalid'})).status).toBe(400);
  });
  it('returns only enabled manager choices without credential fields',async()=>{
    const result=await read('/api/employee-managers');
    expect(result.status).toBe(200);expect(result.body.managers).toEqual([{id:manager,display_name:'Demo Manager'}]);
    expect(JSON.stringify(result.body)).not.toContain('password');
  });
  it('removes a record from a manager scope after HR unassigns it',async()=>{
    await write('patch',`/api/employees/${own}`,{manager_user_id:null});
    expect((await read(`/api/employees/${own}`,'Manager')).status).toBe(404);
    expect((await read('/api/employees','Manager')).body.pagination.total).toBe(0);
  });
});
