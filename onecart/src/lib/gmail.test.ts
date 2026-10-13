import { describe, expect, it } from 'vitest';

import { decodeBase64Url, htmlToText, messageToText } from './gmail';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

describe('gmail helpers', () => {
  it('decodes base64url with UTF-8', () => {
    expect(decodeBase64Url(b64url('Café ✓'))).toBe('Café ✓');
  });

  it('strips html', () => {
    expect(htmlToText('<p>Tracking:&nbsp;<b>1Z999AA10123456784</b></p><style>x{}</style>')).toContain(
      'Tracking: 1Z999AA10123456784',
    );
  });

  it('prefers the plain text part and keeps headers', () => {
    const text = messageToText({
      id: '1',
      payload: {
        headers: [
          { name: 'From', value: 'Shop <a@b.c>' },
          { name: 'Subject', value: 'Shipped' },
        ],
        parts: [
          { mimeType: 'text/html', body: { data: b64url('<p>html</p>') } },
          { mimeType: 'text/plain', body: { data: b64url('plain body') } },
        ],
      },
    });
    expect(text).toBe('From: Shop <a@b.c>\nSubject: Shipped\n\nplain body');
  });
});
