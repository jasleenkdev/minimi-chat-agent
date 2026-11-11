import { useEffect, useState } from 'react';

export function App() {
  const [status, setStatus] = useState('checking');
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((j) => setStatus(j.ok ? 'ok' : 'down'))
      .catch(() => setStatus('down'));
  }, []);
  return <p>api: {status}</p>;
}
