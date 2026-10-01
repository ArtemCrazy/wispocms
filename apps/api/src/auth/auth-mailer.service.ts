import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class AuthMailerService {
  private transport() {
    const port = Number(process.env.SMTP_PORT ?? 25);
    const user = process.env.SMTP_USER?.trim();
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? '127.0.0.1',
      port,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 7000,
      secure:
        process.env.SMTP_SECURE !== undefined
          ? process.env.SMTP_SECURE === 'true'
          : port === 465,
      ...(user ? { auth: { user, pass: process.env.SMTP_PASS ?? '' } } : {}),
    });
  }

  async sendAdminPasswordReset({
    email,
    fullName,
    url,
  }: {
    email: string;
    fullName: string;
    url: string;
  }) {
    try {
      await this.transport().sendMail({
        from: process.env.MAIL_FROM ?? 'Wispo CMS <noreply@crazy.studio>',
        to: email,
        subject: 'Подтверждение смены пароля Wispo CMS',
        text: [
          `${fullName},`,
          '',
          'Чтобы изменить пароль администратора Wispo, откройте ссылку:',
          url,
          '',
          'Ссылка действует 30 минут и может быть использована один раз.',
          'Если вы не запрашивали смену пароля, проигнорируйте это письмо.',
        ].join('\n'),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Не удалось отправить письмо. Проверьте настройки почты и повторите попытку',
      );
    }
  }
}
