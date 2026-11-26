/**
 * Return a URL safe to put in an error message or log: scheme, host and path
 * only. Query strings can carry API keys (for example `?key=` or `?app_key=`),
 * and error text from these scripts can reach the model and the user.
 */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}
