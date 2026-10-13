import { useState } from 'react';

import { Button, Card, Field, Row, Screen, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fetchShippingEmails } from '@/lib/gmail';
import { makeId } from '@/lib/id';
import { parseShippingEmail } from '@/lib/tracking/email-parser';
import { useGmailAuth } from '@/lib/use-gmail-auth';
import type { Shipment } from '@/lib/types';
import { useAppState } from '@/state/app-state';

function toShipments(text: string, receivedAt = new Date().toISOString()): Shipment[] {
  const parsed = parseShippingEmail(text);
  return parsed.shipments.map((s) => ({
    id: makeId('shp'),
    source: 'email',
    storeName: parsed.storeName ?? 'Online order',
    title: parsed.orderNumber ? `Order ${parsed.orderNumber}` : 'Package from email',
    carrier: s.carrier,
    trackingNumber: s.trackingNumber,
    createdAt: receivedAt,
    orderNumber: parsed.orderNumber,
  }));
}

export default function ImportEmailScreen() {
  const c = useTheme();
  const { state, dispatch } = useAppState();
  const gmail = useGmailAuth();
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pasted, setPasted] = useState('');
  const preview = pasted.trim() ? toShipments(pasted) : [];

  async function scanGmail(token: string) {
    setScanning(true);
    setMessage(undefined);
    try {
      const emails = await fetchShippingEmails(token);
      let added = 0;
      for (const email of emails) {
        if (state.importedEmailIds.includes(email.id)) continue;
        const shipments = toShipments(email.text);
        added += shipments.length;
        dispatch({ type: 'shipmentsImported', shipments, emailId: email.id });
      }
      setMessage(`Checked ${emails.length} emails, found ${added} new ${added === 1 ? 'package' : 'packages'}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  return (
    <Screen>
      <Card>
        <T variant="heading">Gmail</T>
        <T muted>
          OneCart reads shipping emails (read-only) and adds the packages. It never sends or deletes mail.
        </T>
        {!gmail.configured ? (
          <T variant="caption" muted>
            Gmail sign-in isn't set up in this build yet. Add a Google client ID (see README).
          </T>
        ) : gmail.accessToken ? (
          <Button title="Scan my inbox" loading={scanning} onPress={() => scanGmail(gmail.accessToken!)} />
        ) : (
          <Button title="Connect Gmail" disabled={!gmail.ready} onPress={gmail.signIn} />
        )}
        {gmail.error ? <T style={{ color: c.danger }}>{gmail.error}</T> : null}
        {message ? <T>{message}</T> : null}
      </Card>

      <Card>
        <T variant="heading">Paste a shipping email</T>
        <T muted>Works with any store: paste the email text or just the tracking number.</T>
        <Field
          multiline
          value={pasted}
          onChangeText={setPasted}
          placeholder={'Your order #1234 has shipped!\nTracking number: 1Z999AA10123456784'}
          style={{ minHeight: 140, textAlignVertical: 'top' }}
        />
        {pasted.trim() ? (
          preview.length ? (
            preview.map((s) => (
              <Row key={s.trackingNumber}>
                <T variant="label" style={{ flex: 1 }}>
                  {s.storeName}
                </T>
                <T variant="caption" muted>
                  {s.carrier} {s.trackingNumber}
                </T>
              </Row>
            ))
          ) : (
            <T muted>No tracking number found yet.</T>
          )
        ) : null}
        <Button
          title={preview.length ? `Add ${preview.length} ${preview.length === 1 ? 'package' : 'packages'}` : 'Add package'}
          disabled={!preview.length}
          onPress={() => {
            dispatch({ type: 'shipmentsImported', shipments: preview });
            setPasted('');
            setMessage(`Added ${preview.length} ${preview.length === 1 ? 'package' : 'packages'}.`);
          }}
        />
      </Card>
    </Screen>
  );
}
