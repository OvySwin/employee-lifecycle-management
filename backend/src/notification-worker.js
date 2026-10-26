import { inTransaction } from './workflow-start.js';
// An at-least-once outbox: the provider idempotency key prevents duplicates across retries.
const MAX_ATTEMPTS=8;
export async function processNotificationBatch(database, {apiKey=process.env.RESEND_API_KEY, from=process.env.NOTIFICATION_FROM, fetchImpl=fetch, limit=10}={}) {
  if (!apiKey || !from) return {processed:0,disabled:true};
  let processed=0;
  for(let n=0;n<limit;n++){
    const message=await inTransaction(database,async client=>{
      const found=await client.query(`
        SELECT o.id,o.event_key,o.subject,o.body,u.email
        FROM notification_outbox o JOIN app_users u ON u.id=o.recipient_user_id
        WHERE (o.status IN ('Pending','Failed') OR
          (o.status='Sending' AND o.next_attempt_at<=now()))
          AND o.next_attempt_at<=now() AND o.attempts<$1 AND u.enabled=true
        ORDER BY o.created_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,[MAX_ATTEMPTS]);
      const candidate=found.rows[0];
      if(candidate) await client.query(`
        UPDATE notification_outbox SET status='Sending',attempts=attempts+1,
          next_attempt_at=now()+interval '2 minutes' WHERE id=$1`,[candidate.id]);
      return candidate;
    });
    if(!message) break;
    processed++;
    try{
      const response=await fetchImpl('https://api.resend.com/emails',{
        method:'POST',
        headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':message.event_key},
        body:JSON.stringify({from,to:[message.email],subject:message.subject,text:message.body}),
        signal:AbortSignal.timeout(10000)
      });
      if(!response.ok)throw new Error('Email provider HTTP '+response.status);
      await database.query("UPDATE notification_outbox SET status='Sent',sent_at=now(),last_error=NULL WHERE id=$1",[message.id]);
    }catch(error){
      await database.query(`UPDATE notification_outbox SET status='Failed',last_error=$2,
        next_attempt_at=now()+make_interval(mins=>least(60, power(2,least(attempts,6))::integer))
        WHERE id=$1`,[message.id,String(error.message).slice(0,180)]);
    }
  }
  return {processed,disabled:false};
}
