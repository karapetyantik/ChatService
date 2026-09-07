import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, Observable } from 'rxjs';
import type { Metadata } from '@grpc/grpc-js';
import { buildInternalGrpcMetadata } from './internal-grpc-metadata';

interface MediaVerifyResult {
  placeholder?: string;
  valid: boolean;
  url: string;
  mimeType: string;
}

interface MediaInternalGrpcService {
  verifyMedia(
    data: { mediaId: string; uploaderId: string },
    metadata?: Metadata,
  ): Observable<MediaVerifyResult>;
}

@Injectable()
export class MediaClientService implements OnModuleInit {
  private grpcService!: MediaInternalGrpcService;

  constructor(
    @Inject('MEDIA_GRPC_SERVICE') private readonly client: ClientGrpc,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.grpcService =
      this.client.getService<MediaInternalGrpcService>('MediaInternal');
  }

  async verifyMedia(mediaId: string, uploaderId: string) {
    return firstValueFrom(
      this.grpcService.verifyMedia(
        { mediaId, uploaderId },
        buildInternalGrpcMetadata(
          this.config.getOrThrow<string>('INTERNAL_API_KEY'),
        ),
      ),
    );
  }
}
