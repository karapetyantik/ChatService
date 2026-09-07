import { Module } from '@nestjs/common';
import { GrpcChatController } from './grpc-chat.controller';
import { ChatsModule } from '@modules/chats/chats.module';
import { MessagesModule } from '@modules/messages/messages.module';

@Module({
  imports: [ChatsModule, MessagesModule],
  controllers: [GrpcChatController],
})
export class GrpcInternalModule {}
