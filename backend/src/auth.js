import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { hashPassword, verifyPassword } from './passwords.js';
import { employeeRoutes } from './employees.js';
import { offboardingRoutes } from './offboarding.js';
const digest = value => createHash('sha256').update(value).digest('hex');
const dummyPassword = hashPassword(randomBytes(32).toString('hex'));
export function authRoutes(database, { origin = 'http://localhost:5173', secure = false, sessionHours = 8, limiter = true } = {}) {
  const router = Router();
  const cookieName = secure ? '__Host-elm_session' : 'elm_session';
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: sessionHours * 3600000 };
  function tokenFromRequest(req) {
    const entries = (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
    const token = entries.length === 1 ? entries[0].slice(cookieName.length+1) : '';
    return /^[a-f0-9]{64}$/.test(token) ? token : null;
  }
  // Browser writes require the configured origin, including login (login CSRF).
  router.use((req,res,next) => {
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin !== origin) return res.status(403).json({ error: 'Request origin rejected' });
    next();
  });
  const loginLimiter = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
  router.post('/auth/login', ...(limiter ? [loginLimiter] : []), async (req,res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 128 || password.length === 0) return res.status(401).json({ error: 'Invalid email or password' });
    const user = (await database.query('SELECT id,email,display_name,role,password_hash,enabled FROM app_users WHERE email=$1', [email.trim().toLowerCase()])).rows[0];
    const valid = await verifyPassword(password, user?.password_hash || await dummyPassword);
    if (!user || !valid || !user.enabled) return res.status(401).json({ error: 'Invalid email or password' });
    const token = randomBytes(32).toString('hex');
    const csrfToken = digest(`${token}:csrf`);
    const previous = tokenFromRequest(req);
    if (previous) await database.query('DELETE FROM auth_sessions WHERE token_hash=$1',[digest(previous)]);
    await database.query('INSERT INTO auth_sessions(token_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,$4)', [digest(token),user.id,digest(csrfToken),new Date(Date.now()+sessionHours*3600000)]);
    res.cookie(cookieName, token, cookieOptions);
    res.set('Cache-Control','no-store').json({ user: publicUser(user), csrfToken });
  });
  router.use(async (req,res,next) => {
    const token = tokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const session = (await database.query('SELECT u.id,u.email,u.display_name,u.role,s.csrf_hash FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.enabled=true',[digest(token)])).rows[0];
    if (!session) return res.status(401).json({ error: 'Authentication required' });
    req.user = publicUser(session);
    req.sessionHash = digest(token);
    req.csrfToken = digest(`${token}:csrf`);
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const provided = req.headers['x-csrf-token'];
      if (typeof provided !== 'string' || provided.length !== 64 || !timingSafeEqual(Buffer.from(digest(provided),'hex'),Buffer.from(session.csrf_hash,'hex'))) return res.status(403).json({ error: 'CSRF verification failed' });
    }
    res.set('Cache-Control','no-store');
    next();
  });
  router.get('/auth/me', (req,res) => res.json({ user: req.user, csrfToken: req.csrfToken }));
  router.post('/auth/logout', async (req,res) => {
    await database.query('DELETE FROM auth_sessions WHERE token_hash=$1',[req.sessionHash]);
    res.clearCookie(cookieName,{ httpOnly:true,secure,sameSite:'strict',path:'/' });
    res.sendStatus(204);
  });
  router.use(employeeRoutes(database));
  router.use(offboardingRoutes(database));
  router.get('/tasks', async (req,res) => {
    const query = req.user.role === 'HR' ? ['SELECT id,title,status FROM workflow_tasks ORDER BY id LIMIT 100',[]] : ['SELECT id,title,status FROM workflow_tasks WHERE assignee_user_id=$1 AND assigned_role=$2 ORDER BY id LIMIT 100',[req.user.id,req.user.role]];
    res.json({ tasks: (await database.query(...query)).rows });
  });
  return router;
}
function publicUser(user) { return { id:user.id,email:user.email,displayName:user.display_name,role:user.role }; }
