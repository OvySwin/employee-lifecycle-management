import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EmployeeWorkspace, OnboardingChecklistList, OnboardingChecklistPage, OffboardingChecklistPage, ProgressDashboard, NotificationInbox } from './EmployeeWorkspace.jsx';
import './style.css';
function onboardingEmployeeFromHash() {
  const match=window.location.hash.slice(1).match(/^\/onboarding\/([0-9a-f-]+)$/i);
  return match?.[1] || null;
}
function offboardingEmployeeFromHash(){return window.location.hash.slice(1).match(/^\/offboarding\/([0-9a-f-]+)$/i)?.[1]||null;}
function App() {
  const [user,setUser] = useState(null), [csrf,setCsrf] = useState('');
  const [onboardingEmployeeId,setOnboardingEmployeeId] = useState(onboardingEmployeeFromHash);
  const [offboardingEmployeeId,setOffboardingEmployeeId]=useState(offboardingEmployeeFromHash);
  const [email,setEmail] = useState(''), [password,setPassword] = useState('');
  const [message,setMessage] = useState(''), [busy,setBusy] = useState(true);
  const [tasks,setTasks] = useState([]);
  const [ready,setReady] = useState('Checking connection…');
  const expired=useCallback(()=>{setUser(null);setCsrf('');setTasks([]);setMessage('Session expired. Please log in again.');},[]);
  useEffect(()=>{
    const update=()=>{setOnboardingEmployeeId(onboardingEmployeeFromHash());setOffboardingEmployeeId(offboardingEmployeeFromHash());};
    window.addEventListener('hashchange',update);
    return ()=>window.removeEventListener('hashchange',update);
  },[]);
  async function loadData() {
    const response=await fetch('/api/tasks');
    if(response.status===401){expired();throw new Error('Session expired. Please log in again.');}
    if(!response.ok)throw new Error('Unable to load authorised tasks.');
    setTasks((await response.json()).tasks || []);
  }
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) { setUser(data.user); setCsrf(data.csrfToken); await loadData(); }
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
      window.location.hash='/employees';
      setUser(data.user); setCsrf(data.csrfToken); setPassword(''); await loadData();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/auth/logout',{method:'POST',headers:{'X-CSRF-Token':csrf}});
      if (!response.ok && response.status !== 401) throw new Error('Logout failed. Please try again.');
      setUser(null); setCsrf(''); setTasks([]); setPassword('');window.location.hash='/employees';
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <main><p>SWE40006 · Deployment pipeline demo v1</p><h1>Employee Lifecycle Management</h1><p role="status">{ready}</p>
    {message && <p role="alert">{message}</p>}
    {!user ? <form onSubmit={login}><h2>Sign in</h2><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={event=>setEmail(event.target.value)}/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={event=>setPassword(event.target.value)}/><button disabled={busy}>{busy ? 'Please wait…':'Sign in'}</button></form> : <section><h2>{user.displayName}</h2><p>Role: {user.role}</p><button disabled={busy} onClick={logout}>Sign out</button>
      {offboardingEmployeeId ? <OffboardingChecklistPage key={offboardingEmployeeId} employeeId={offboardingEmployeeId} user={user} csrf={csrf} onAuthExpired={expired}/> : onboardingEmployeeId ? <OnboardingChecklistPage key={onboardingEmployeeId} employeeId={onboardingEmployeeId} user={user} csrf={csrf} onAuthExpired={expired}/> : user.role !== 'IT' && <EmployeeWorkspace user={user} csrf={csrf} onAuthExpired={expired}/>}
      {!onboardingEmployeeId && !offboardingEmployeeId && <><NotificationInbox onAuthExpired={expired}/><ProgressDashboard user={user} csrf={csrf} onAuthExpired={expired}/><h3>{user.role==='HR'?'Tasks':'Your assigned tasks'}</h3>{tasks.length ? <ul>{tasks.map(task=><li key={task.id}>{task.title} — {task.status}</li>)}</ul>:<p>No tasks in your authorised scope.</p>}
        {user.role==='IT' && <OnboardingChecklistList onAuthExpired={expired}/>}
      </>}
    </section>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
