# Application authentication and permissions

| Role | Employees read | Tasks read | Planned writes (future tickets) |
|---|---|---|---|
| HR | All employees and onboarding checklists | All tasks | Employee editing, workflow initiation and approval of HR-assigned onboarding steps |
| Manager | Assigned employees and their onboarding checklists | Explicitly assigned Manager tasks only | No onboarding-step approval |
| IT | Full onboarding checklists for employees with IT-assigned onboarding tasks; no employee-list endpoint | Explicitly assigned IT tasks only | Approval of IT-assigned onboarding steps |

Authentication routes: POST /api/auth/login, GET /api/auth/me and POST /api/auth/logout. Employee routes support HR create/edit, manager-scoped detail reads and pagination; see EMPLOYEE_API.md for the complete contract. HR starts onboarding with POST /api/employees/:id/onboarding. The generated checklist is displayed on a dedicated frontend page and visible to HR, the assigned manager and IT; IT sees checklists only where the latest workflow has an IT-assigned task. HR and IT approve pending steps assigned to their role with POST /api/onboarding-tasks/:id/approve; managers can view but not approve. Approving every task completes the workflow and atomically changes the employee lifecycle status to Active. GET /api/tasks still returns at most 100 authorised tasks. HTTP 401 means no valid enabled-user session; 403 means permission, origin or CSRF rejection. No public registration.

Passwords use Node scrypt with random 16-byte salts (N=32768,r=8,p=1). Login failures use generic responses and a dummy password hash for unknown emails. Login rate limiting permits 20 attempts per IP per 15 minutes in this single-instance implementation; distributed deployments require a shared limiter store and reviewed trusted-proxy settings.

Session cookies are HttpOnly, SameSite=Strict, Path=/ and expire after 8 hours with no sliding extension. Production uses Secure __Host- cookies and requires HTTPS APP_ORIGIN. Server stores only SHA-256 session-token hashes. Logout, expiry, disabled users and replacing a cookie-bearing session invalidate access. /api/auth/me supports session restoration after reload. CSRF tokens are separate from the cookie bearer token and returned only to same-origin clients; writes require matching Origin and X-CSRF-Token (login requires Origin before a session exists). No cross-origin CORS access is configured. Development Vite proxy keeps browser requests same-origin.

## MFA decision and boundaries

This foundations implementation supplies password/session authentication for the synthetic local demonstration. MFA is **not implemented**. The project brief mentions MFA; select and implement an MFA-capable identity provider or TOTP step before treating this as production-ready authentication. This is a documented refinement decision, not a claim that MFA has been delivered. Application roles protect app data; AWS IAM separately protects cloud infrastructure and does not replace app authorization.

Expired sessions remain unusable even if their database records have not been cleaned up. A scheduled cleanup query (`DELETE FROM auth_sessions WHERE expires_at <= now()`) and central rate limiter belong in production operations. Do not expose hashes, cookies, passwords or personal data in logs or evidence. Demo logins use a private SEED_PASSWORD set locally; no default password is committed.
