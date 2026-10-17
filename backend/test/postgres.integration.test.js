import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { migrate } from '../src/migrations.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

// Opt in only with a disposable database; never target a shared environment.
describe.skipIf(process.env.RUN_POSTGRES_TESTS !== '1')('real PostgreSQL driver',()=>{
  let pool, app, employee, cookie, csrf;
  const origin='http://localhost:8080',password='CI-synthetic-only-2026';
  beforeAll(async()=>{
    pool=new pg.Pool({connectionTimeoutMillis:5000,max:5});
    const client=await pool.connect();
    try { await migrate(client); await migrate(client); await seed(client,password); }
    finally { client.release(); }
    app=createApp(()=>pool.query('SELECT 1'),pool,{origin,limiter:false});
    const login=await request(app).post('/api/auth/login').set('Origin',origin).send({email:'hr@example.test',password});
    expect(login.status).toBe(200);
    cookie=login.headers['set-cookie'][0].split(';')[0];csrf=login.body.csrfToken;
    employee=(await pool.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date,lifecycle_status) VALUES('CI-PG-001','Synthetic CI Person','Analyst','Testing','Sydney','2026-01-01','Active') RETURNING id")).rows[0].id;
  },30000);
  afterAll(async()=>{await pool?.end();});
  it('serializes two simultaneous offboarding requests and persists one complete checklist',async()=>{
    const start=()=>request(app).post(`/api/employees/${employee}/offboarding`).set('Origin',origin).set('Cookie',cookie).set('X-CSRF-Token',csrf).send({end_date:'2026-11-01'});
    const responses=await Promise.all([start(),start()]);
    expect(responses.map(r=>r.status).sort()).toEqual([201,409]);
    const workflows=await pool.query('SELECT id FROM workflows WHERE employee_id=$1',[employee]);
    expect(workflows.rows).toHaveLength(1);
    expect((await pool.query('SELECT id FROM workflow_tasks WHERE workflow_id=$1',[workflows.rows[0].id])).rows).toHaveLength(3);
    expect((await pool.query('SELECT lifecycle_status FROM employees WHERE id=$1',[employee])).rows[0].lifecycle_status).toBe('Offboarding');
  });
});
