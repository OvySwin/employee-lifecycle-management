# Workflow notifications (ELA-24)

Notifications are created inside the same database transaction as the workflow operation. In-app notifications are visible to their recipients at `GET /api/notifications` and in the signed-in interface.

## Events
- Starting an onboarding or offboarding workflow queues a notification for enabled HR/IT users whose role has generated tasks.
- Completing all required tasks queues a completion notification for enabled HR users.
- Repeated attempts with the same event key do not queue duplicate notifications.

## Email delivery
Optional external delivery uses the Resend HTTPS email API. Configure **both** server-side variables to enable email:

```dotenv
RESEND_API_KEY=your-private-api-key
NOTIFICATION_FROM=verified-sender@your-domain.example
```

Do not commit actual credentials. Without these variables, in-app notifications continue working and the email outbox stays pending. Verify your sender domain and provider account before expecting external email delivery. The background worker processes at most 10 messages per minute; HTTP failures are retained for exponential-backoff retries, with a maximum of 8 attempts. The provider event key is passed as an idempotency key. A two-minute abandoned-send lease is reclaimable after worker interruption.

**Privacy:** Demo email addresses end in `example.test` and will not receive real messages. Configure users with deliverable addresses only in an authorised deployment. Notifications intentionally avoid confidential identity, access or password details.

**Known gaps:** Automated overdue reminders and user-configurable notification preferences are not yet implemented; this PR covers workflow event notifications and delivery transport, not every possible message type. Test with a real provider using a verified sender in a non-production environment before promotion.
