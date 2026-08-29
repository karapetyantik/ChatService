import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { ChatsService } from '../chats.service';

@Controller()
export class GrpcChatController {
  constructor(private readonly chatsService: ChatsService) {}

  @GrpcMethod('ChatInternal', 'GetChatMembers')
  async getChatMembers(data: { chatId: string }) {
    const memberIds = await this.chatsService.getMemberIds(data.chatId);
    return { memberIds };
  }

  @GrpcMethod('ChatInternal', 'IsMember')
  async isMember(data: { chatId: string; userId: string }) {
    const result = await this.chatsService.isMember(data.chatId, data.userId);
    return { isMember: result };
  }
}
