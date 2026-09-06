import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('service endpoints', () => {
    it('returns service metadata', () => {
      expect(appController.getServiceInfo()).toMatchObject({
        service: 'wispo-cms-api',
        version: '0.1.0',
      });
    });

    it('returns a healthy status', () => {
      expect(appController.getHealth()).toMatchObject({
        status: 'ok',
        service: 'wispo-cms-api',
      });
    });
  });
});
