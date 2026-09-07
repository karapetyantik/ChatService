import { Controller, Logger, UseGuards } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { ChatsService } from '@modules/chats/chats.service';
import { MessagesService } from '@modules/messages/messages.service';
import { InternalGrpcAuthGuard } from './internal-grpc-auth.guard';

@UseGuards(InternalGrpcAuthGuard)
@Controller()
export class GrpcChatController {
  private readonly logger = new Logger(GrpcChatController.name);

  constructor(
    private readonly chatsService: ChatsService,
    private readonly messagesService: MessagesService,
  ) {}

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

  @GrpcMethod('ChatInternal', 'SendMessageInternal')
  async sendMessageInternal(data: {
    chatId: string;
    senderId: string;
    content: string;
  }) {
    try {
      const result = await this.messagesService.sendMessage(data.senderId, {
        chatId: data.chatId,
        content: data.content,
      });
      return {
        success: true,
        messageId: result.messageId,
        error: '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Ошибка внутренней отправки сообщения: ${message}`);
      return { success: false, messageId: '', error: message };
    }
  }
}
