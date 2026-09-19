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

interface MediaUrlEntry {
  mediaId: string;
  url: string;
  isAvailable: boolean;
}

export interface MediaUrlLookup {
  url: string;
  isAvailable: boolean;
}

interface MediaUrlsResponse {
  urls: MediaUrlEntry[];
}

interface MediaInternalGrpcService {
  verifyMedia(
    data: { mediaId: string; uploaderId: string },
    metadata?: Metadata,
  ): Observable<MediaVerifyResult>;
  getMediaUrls(
    data: { mediaIds: string[] },
    metadata?: Metadata,
  ): Observable<MediaUrlsResponse>;
}

@Injectable()
export class MediaClientService implements OnModuleInit {
  private grpcService!: MediaInternalGrpcService;

  constructor(
    @Inject('MEDIA_GRPC_SERVICE') private readonly client: ClientGrpc,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.grpcService =
      this.client.getService<MediaInternalGrpcService>('MediaInternal');
  }

  async verifyMedia(
    mediaId: string,
    uploaderId: string,
  ): Promise<MediaVerifyResult> {
    return firstValueFrom(
      this.grpcService.verifyMedia(
        { mediaId, uploaderId },
        buildInternalGrpcMetadata(
          this.config.getOrThrow<string>('INTERNAL_API_KEY'),
        ),
      ),
    );
  }

  async getMediaUrls(mediaIds: string[]): Promise<Map<string, MediaUrlLookup>> {
    const response = await firstValueFrom(
      this.grpcService.getMediaUrls(
        { mediaIds },
        buildInternalGrpcMetadata(
          this.config.getOrThrow<string>('INTERNAL_API_KEY'),
        ),
      ),
    );
    return new Map(
      response.urls.map((u) => [
        u.mediaId,
        { url: u.url, isAvailable: u.isAvailable },
      ]),
    );
  }
}
