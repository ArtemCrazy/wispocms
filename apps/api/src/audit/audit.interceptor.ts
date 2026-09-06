import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return next.handle().pipe(
      mergeMap((result: unknown) =>
        from(
          this.auditService
            .recordRequest(request)
            .catch((reason: unknown) =>
              this.logger.error(
                `Не удалось записать аудит: ${reason instanceof Error ? reason.message : String(reason)}`,
              ),
            )
            .then(() => result),
        ),
      ),
    );
  }
}
