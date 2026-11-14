-- Send the Resend waitlist confirmation when someone joins the waitlist.
-- Calls the send-waitlist-confirmation Edge Function through pg_net after the
-- insert commits. Any failure here is swallowed so a signup never fails
-- because of email; the function logs its own outcome to sync_log.

create or replace function public.waitlist_send_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'integrations_cron_secret';

  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://fmrabsrgdwqhyxcjnfgt.supabase.co/functions/v1/send-waitlist-confirmation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-farbird-internal', v_secret
    ),
    body := jsonb_build_object('waitlist_id', new.id),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  raise warning 'waitlist_send_confirmation failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.waitlist_send_confirmation() from public, anon, authenticated;

create trigger waitlist_send_confirmation
after insert on public.waitlist
for each row execute function public.waitlist_send_confirmation();
