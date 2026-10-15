import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
function App() {
  const [user,setUser] = useState(null), [csrf,setCsrf] = useState('');
  const [email,setEmail] = useState(''), [password,setPassword] = useState('');
  const [message,setMessage] = useState(''), [busy,setBusy] = useState(true);
  const [employees,setEmployees] = useState([]), [tasks,setTasks] = useState([]);
  const [ready,setReady] = useState('Checking connection…');
  async function loadData(currentUser) {
    const paths = currentUser.role === 'IT' ? ['/api/tasks'] : ['/api/employees','/api/tasks'];
    const results = await Promise.all(paths.map(async path => {
      const response = await fetch(path);
      if (response.status === 401) { setUser(null); setCsrf(''); throw new Error('Session expired. Please log in again.'); }
      if (!response.ok) throw new Error('Unable to load authorised records.');
      return response.json();
    }));
    setEmployees(results.find(result => result.employees)?.employees || []);
    setTasks(results.find(result => result.tasks)?.tasks || []);
  }
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) { setUser(data.user); setCsrf(data.csrfToken); await loadData(data.user); }
        } else if (response.status !== 401) throw new Error('Login service unavailable.');
      } catch (error) { if (!cancelled) setMessage(error.message); }
      finally { if (!cancelled) setBusy(false); }
    }
    restore();
    fetch('/ready').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(() => { if (!cancelled) setReady('API and database connected'); }).catch(() => { if (!cancelled) setReady('API or database unavailable. Check local setup.'); });
    return () => { cancelled = true; };
  }, []);
  async function login(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/auth/login',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Login failed');
      setUser(data.user); setCsrf(data.csrfToken); setPassword(''); await loadData(data.user);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/auth/logout',{method:'POST',headers:{'X-CSRF-Token':csrf}});
      if (!response.ok && response.status !== 401) throw new Error('Logout failed. Please try again.');
      setUser(null); setCsrf(''); setEmployees([]); setTasks([]); setPassword('');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <main><p>SWE40006 · Development</p><h1>Employee Lifecycle Management</h1><p role="status">{ready}</p>
    {message && <p role="alert">{message}</p>}
    {!user ? <form onSubmit={login}><h2>Sign in</h2><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={event=>setEmail(event.target.value)}/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={event=>setPassword(event.target.value)}/><button disabled={busy}>{busy ? 'Please wait…':'Sign in'}</button></form> : <section><h2>{user.displayName}</h2><p>Role: {user.role}</p><button disabled={busy} onClick={logout}>Sign out</button>
      {user.role !== 'IT' && <><h3>{user.role==='HR'?'Employees':'Your employees'}</h3>{employees.length ? <ul>{employees.map(employee=><li key={employee.id}>{employee.full_name} — {employee.lifecycle_status}</li>)}</ul>:<p>No employees in your authorised scope.</p>}</>}
      <h3>{user.role==='HR'?'Tasks':'Your assigned tasks'}</h3>{tasks.length ? <ul>{tasks.map(task=><li key={task.id}>{task.title} — {task.status}</li>)}</ul>:<p>No tasks in your authorised scope.</p>}
      <p>Employee editing and lifecycle workflows will be added in the next tickets.</p></section>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);

