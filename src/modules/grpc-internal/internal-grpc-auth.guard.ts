import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Metadata } from '@grpc/grpc-js';
import { timingSafeEqual } from 'crypto';

const INTERNAL_KEY_METADATA_FIELD = 'x-internal-key';

@Injectable()
export class InternalGrpcAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const metadata = context.switchToRpc().getContext<Metadata>();
    const providedRaw: string | Buffer | undefined = metadata.get(
      INTERNAL_KEY_METADATA_FIELD,
    )[0];
    const expectedRaw: string =
      this.config.getOrThrow<string>('INTERNAL_API_KEY');

    if (typeof providedRaw !== 'string' || !providedRaw) {
      throw new UnauthorizedException('Invalid internal service credentials');
    }

    const providedBuffer: Buffer = Buffer.from(providedRaw);
    const expectedBuffer: Buffer = Buffer.from(expectedRaw);

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid internal service credentials');
    }
    return true;
  }
}
