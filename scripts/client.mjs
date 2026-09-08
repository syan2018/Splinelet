export async function call(action, args = {}) {
  const response = await fetch('http://127.0.0.1:4318/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
