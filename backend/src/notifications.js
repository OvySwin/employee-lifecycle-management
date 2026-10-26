import { Router } from 'express';

export async function enqueueNotification(client, eventKey, recipientUserId, subject, body) {
  if (!recipientUserId) return;
  await client.query(`INSERT INTO notification_outbox(event_key,recipient_user_id,subject,body)
    VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING`,
    [eventKey,recipientUserId,subject,body]);
}

// The in-app notification list works even before email transport is configured.
export function notificationRoutes(database) {
  const router=Router();
  router.get('/notifications',async(req,res,next)=>{
    try {
      const notifications=(await database.query(`
        SELECT id,subject,body,status,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM notification_outbox WHERE recipient_user_id=$1
        ORDER BY created_at DESC,id DESC LIMIT 50`,[req.user.id])).rows;
      res.json({notifications});
    }catch(error){next(error);}
  });
  return router;
}
