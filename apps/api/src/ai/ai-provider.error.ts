import { ServiceUnavailableException } from '@nestjs/common';

/** Only fixed, user-safe messages: never use raw provider errors or response bodies. */
export class AiProviderError extends ServiceUnavailableException {}
