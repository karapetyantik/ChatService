import { Module, Options } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from 'src/modules/messages/messages.service';
import { MessagesController } from 'src/modules/messages/messages.controller';
import { CassandraModule } from '../../common/cassandra/cassandra.module';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [
    CassandraModule,
    ChatsModule,
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
  providers: [MessagesService],
  controllers: [MessagesController],
})
export class MessagesModule {}
