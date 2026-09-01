const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const API_KEY =
  import.meta.env.VITE_DASHBOARD_MODE === 'client_fi'
    ? import.meta.env.VITE_READ_ONLY_API_KEY || import.meta.env.VITE_API_KEY || ''
    : import.meta.env.VITE_API_KEY || '';

export async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'same-origin',
    headers: API_KEY ? { 'X-API-Key': API_KEY } : {},
  });
  if (!response.ok) throw new Error(readApiError(await response.text()));
  return response.json();
}

export async function apiSend(path, { method = 'POST', body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(readApiError(await response.text()));
  return response.json();
}

function readApiError(text) {
  if (/FUNCTION_INVOCATION_TIMEOUT/i.test(text)) {
    return 'Find new leads timed out. Click again — it now skips listings we already have.';
  }
  try {
    const parsed = JSON.parse(text);
    return parsed.error || parsed.message || text;
  } catch {
    return text || 'Request failed';
  }
}
