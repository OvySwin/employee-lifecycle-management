CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  recipient_user_id uuid NOT NULL REFERENCES app_users(id),
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Sending','Sent','Failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text
);
CREATE INDEX notification_outbox_due ON notification_outbox(next_attempt_at) WHERE status IN ('Pending','Failed');
