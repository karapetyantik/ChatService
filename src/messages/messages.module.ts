import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { CassandraModule } from '../cassandra/cassandra.module';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [CassandraModule, ChatsModule],
  providers: [MessagesService],
  controllers: [MessagesController],
})
export class MessagesModule {}
