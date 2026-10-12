import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
function App() {
  const [status, setStatus] = useState('Checking connection…');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/ready', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Not ready');
      await response.json();
      setStatus('API and database connected');
    }).catch(error => { if (error.name !== 'AbortError') setStatus('API or database unavailable. Check the local setup.'); });
    return () => controller.abort();
  }, []);
  return <main><p>SWE40006 · Development</p><h1>Employee Lifecycle Management</h1><p>Onboarding and offboarding workflows will be implemented here.</p><p role="status">{status}</p></main>;
}
createRoot(document.getElementById('root')).render(<App />);

