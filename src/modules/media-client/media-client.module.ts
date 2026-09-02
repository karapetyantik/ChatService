import { Module } from '@nestjs/common';
import { MediaClientService } from './media-client.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'MEDIA_GRPC_SERVICE',
        useFactory: (config: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'media',
            protoPath: join(process.cwd(), 'dist/proto/media.proto'),
            url: config.getOrThrow<string>('MEDIA_SERVICE_GRPC_URL'),
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [MediaClientService],
  exports: [MediaClientService],
})
export class MediaClientModule {}
