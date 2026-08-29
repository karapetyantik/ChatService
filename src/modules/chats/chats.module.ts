import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { CassandraModule } from 'src/common/cassandra/cassandra.module';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { GrpcChatController } from './grpc-chat/grpc-chat.controller';

@Module({
  imports: [
    CassandraModule,
    ClientsModule.registerAsync([
      {
        name: 'RABBITMQ_SERVICE',
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.getOrThrow<string>('RABBITMQ_URL')],
            queue: 'chat_events',
            queueOptions: { durable: true },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [ChatsController, GrpcChatController],
  providers: [ChatsService, GrpcChatController],
  exports: [ChatsService],
})
export class ChatsModule {}
