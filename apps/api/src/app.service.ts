import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getServiceInfo() {
    return {
      service: 'wispo-cms-api',
      version: '0.1.0',
      documentation: '/api/health',
    };
  }

  getHealth() {
    return {
      status: 'ok',
      service: 'wispo-cms-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
