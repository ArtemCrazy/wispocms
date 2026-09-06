import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { PlatformRole } from '../database/entities';
import { ContentService } from './content.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

describe('ContentService contact email', () => {
  const admin = {
    userId: 'admin-id',
    platformRole: PlatformRole.WISPO_ADMIN,
  };
  const sendMail = jest.fn();
  const verify = jest.fn();

  function setup(notificationEmail: string | null = 'requests@example.ru') {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      name: 'Wispo Media',
      slug: 'wispo-media',
      isActive: true,
      notificationEmail,
    };
    const sites = { findOne: jest.fn().mockResolvedValue(site) };
    const service = new ContentService(
      sites as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, site };
  }

  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({ messageId: 'message-id' });
    verify.mockReset().mockResolvedValue(true);
    jest.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail,
      verify,
    } as never);
  });

  it('sends a public request to the configured recipient', async () => {
    const { service } = setup();

    await expect(
      service.submitContactRequest('wispo-media', '127.0.0.1', {
        name: 'Анна',
        email: 'ANNA@EXAMPLE.RU',
        phone: '+7 999 000-00-00',
        message: 'Хочу обсудить проект',
        consent: true,
      }),
    ).resolves.toEqual({ ok: true });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'requests@example.ru',
        replyTo: 'anna@example.ru',
        subject: 'Новая заявка — Wispo Media',
      }),
    );
  });

  it('does not accept public requests until a recipient is configured', async () => {
    const { service } = setup(null);

    await expect(
      service.submitContactRequest('wispo-media', '127.0.0.1', {
        name: 'Анна',
        email: 'anna@example.ru',
        consent: true,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends a test message only to the saved recipient', async () => {
    const { service } = setup();

    await expect(
      service.sendContactTestEmail('site-id', admin),
    ).resolves.toEqual({ ok: true, email: 'requests@example.ru' });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'requests@example.ru',
        subject: 'Проверка заявок — Wispo Media',
      }),
    );
  });

  it('silently accepts a filled honeypot without sending mail', async () => {
    const { service } = setup();

    await expect(
      service.submitContactRequest('wispo-media', '127.0.0.1', {
        name: 'Bot',
        website: 'https://spam.example',
        consent: false,
      }),
    ).resolves.toEqual({ ok: true });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('limits repeated requests from the same site and IP', async () => {
    const { service } = setup();
    const request = {
      name: 'Анна',
      email: 'anna@example.ru',
      consent: true,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.submitContactRequest('wispo-media', '127.0.0.1', request),
      ).resolves.toEqual({ ok: true });
    }
    await expect(
      service.submitContactRequest('wispo-media', '127.0.0.1', request),
    ).rejects.toBeInstanceOf(HttpException);
    expect(sendMail).toHaveBeenCalledTimes(5);
  });

  it('checks email transport without sending a message', async () => {
    const { service } = setup();

    await expect(
      service.getContactEmailStatus('site-id', admin),
    ).resolves.toEqual({ recipientConfigured: true, transportReady: true });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('returns a safe unavailable status when SMTP cannot be reached', async () => {
    verify.mockRejectedValueOnce(new Error('connection refused'));
    const { service } = setup();

    await expect(
      service.getContactEmailStatus('site-id', admin),
    ).resolves.toEqual({ recipientConfigured: true, transportReady: false });
  });
});
