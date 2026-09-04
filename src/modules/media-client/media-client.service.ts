import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable } from 'rxjs';

interface MediaInternalGrpcService {
  verifyMedia(data: { mediaId: string; uploaderId: string }): Observable<{
    placeholder: any;
    valid: boolean;
    url: string;
    mimeType: string;
  }>;
}

@Injectable()
export class MediaClientService implements OnModuleInit {
  private grpcService!: MediaInternalGrpcService;

  constructor(
    @Inject('MEDIA_GRPC_SERVICE') private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.grpcService =
      this.client.getService<MediaInternalGrpcService>('MediaInternal');
  }

  async verifyMedia(mediaId: string, uploaderId: string) {
    return firstValueFrom(
      this.grpcService.verifyMedia({ mediaId, uploaderId }),
    );
  }
}
