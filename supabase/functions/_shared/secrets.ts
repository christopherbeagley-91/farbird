// Secrets live in Supabase Edge Function secrets. We only ever report whether
// one is set, never its value.

export function secretStatus(names: string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((n) => [n, Boolean(Deno.env.get(n))]));
}

export function missingSecrets(names: string[]): string[] {
  return names.filter((n) => !Deno.env.get(n));
}

export function requireSecret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret ${name} is not set`);
  return value;
}
