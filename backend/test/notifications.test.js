import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
import {migrate} from '../src/migrations.js';
import {seed} from '../src/seed.js';
import {createApp} from '../src/app.js';
import {enqueueNotification} from '../src/notifications.js';
import {processNotificationBatch} from '../src/notification-worker.js';

const origin='http://localhost:5173',password='Notification-test-password-2026';
let db,app,hr,itUser,session;
beforeAll(async()=>{
  db=new PGlite();
  const query=db.query.bind(db);
  db.query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(results=>results.at(-1)):query(sql,args);
  await migrate(db);await seed(db,password);
  const users=(await db.query('SELECT * FROM app_users')).rows;
  hr=users.find(user=>user.role==='HR');itUser=users.find(user=>user.role==='IT');
  app=createApp(()=>db.query('SELECT 1'),db,{limiter:false});
  const login=await request(app).post('/api/auth/login').set('Origin',origin).send({email:hr.email,password});
  session=login.headers['set-cookie'][0].split(';')[0];
},30000);
beforeEach(async()=>{await db.query('DELETE FROM notification_outbox');});
afterAll(async()=>db?.close());

it('queues an event exactly once and scopes in-app notifications to the signed-in user',async()=>{
  await enqueueNotification(db,'test:event:hr',hr.id,'Onboarding started','Open the app.');
  await enqueueNotification(db,'test:event:hr',hr.id,'Onboarding started','Open the app.');
  await enqueueNotification(db,'test:event:it',itUser.id,'Other role event','Not visible to HR.');
  const result=await request(app).get('/api/notifications').set('Cookie',session);
  expect(result.status).toBe(200);
  expect(result.body.notifications).toHaveLength(1);
  expect(result.body.notifications[0]).toMatchObject({subject:'Onboarding started',status:'Pending'});
  expect((await request(app).get('/api/notifications')).status).toBe(401);
});

it('sends one email with an idempotency key and records success',async()=>{
  await enqueueNotification(db,'test:send:1',hr.id,'Offboarding finished','Required tasks completed.');
  const calls=[];
  const processed=await processNotificationBatch(db,{apiKey:'test-only',from:'notify@example.test',
    fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200};}});
  expect(processed).toMatchObject({processed:1,disabled:false});
  expect(calls).toHaveLength(1);
  expect(calls[0].options.headers['Idempotency-Key']).toBe('test:send:1');
  expect(JSON.parse(calls[0].options.body).to).toEqual([hr.email]);
  expect((await db.query("SELECT status,attempts,sent_at FROM notification_outbox WHERE event_key='test:send:1'")).rows[0])
    .toMatchObject({status:'Sent',attempts:1,sent_at:expect.anything()});
  expect((await processNotificationBatch(db,{apiKey:'test-only',from:'notify@example.test',fetchImpl:async()=>{throw Error('should not send')}})).processed).toBe(0);
});
it('retains failed notifications for retry without crashing the request',async()=>{
  await enqueueNotification(db,'test:retry:1',hr.id,'Welcome','Please review tasks.');
  await processNotificationBatch(db,{apiKey:'test-only',from:'notify@example.test',fetchImpl:async()=>({ok:false,status:503})});
  const record=(await db.query("SELECT status,attempts,last_error FROM notification_outbox WHERE event_key='test:retry:1'")).rows[0];
  expect(record.status).toBe('Failed');expect(record.attempts).toBe(1);
  expect(record.last_error).toMatch(/503/);
});
