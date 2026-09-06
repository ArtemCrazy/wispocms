import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import {
  createOriginProtection,
  normalizeOrigins,
} from './security/origin-protection.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const webOrigins = normalizeOrigins(
    process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  );

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(createOriginProtection(webOrigins));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: webOrigins,
    credentials: true,
  });

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
