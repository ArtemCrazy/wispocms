import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ContentCenterService } from './content-center.service';

/** Check workspace access before the multipart interceptor allocates a file buffer. */
@Injectable()
export class MaterialUploadGuard implements CanActivate {
  constructor(private readonly service: ContentCenterService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const workspaceId = request.params.workspaceId;
    if (typeof workspaceId !== 'string' || !isUUID(workspaceId))
      throw new BadRequestException('Некорректное рабочее пространство');
    await this.service.access(workspaceId, request.auth!);
    return true;
  }
}
