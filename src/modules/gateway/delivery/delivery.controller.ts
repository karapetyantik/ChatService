import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { ChatGateway } from '../chat.gateway';
import { RedisService } from '@common/redis/redis.service';

interface MessageSentEvent {
  chatId: string;
  messageId: string;
  senderId: string;
  content?: string;
  attachments?: unknown[];
  type: string;
  createdAt: Date;
  recipientIds: string[];
}

interface MessageReactionEvent {
  chatId: string;
  messageId: string;
  userId: string;
  emoji?: string;
  action: 'add' | 'remove';
  recipientIds: string[];
}

interface ChatReadEvent {
  chatId: string;
  userId: string;
  lastReadMessageId: string;
  recipientIds: string[];
}

@Controller()
export class DeliveryController {
  private readonly logger = new Logger(DeliveryController.name);

  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly redisService: RedisService,
  ) {}

  @EventPattern('message.sent')
  async handleMessageSent(@Payload() event: MessageSentEvent) {
    await this.fanOut(event.recipientIds, 'message', event);
  }

  @EventPattern('message.reaction')
  async handleMessageReaction(@Payload() event: MessageReactionEvent) {
    await this.fanOut(event.recipientIds, 'reaction', event);
    this.logger.log(
      `Реакция ${event.action} разослана по чату ${event.chatId}`,
    );
  }

  @EventPattern('chat.read')
  async handleChatRead(@Payload() event: ChatReadEvent) {
    const recipients = event.recipientIds.filter((id) => id !== event.userId);
    await this.fanOut(recipients, 'read', event);
  }

  private async fanOut(
    recipientIds: string[],
    eventName: string,
    payload: unknown,
  ) {
    for (const userId of recipientIds) {
      const socketIds = await this.redisService.client.smembers(
        `user_sockets:${userId}`,
      );

      for (const socketId of socketIds) {
        this.chatGateway.server.to(socketId).emit(eventName, payload);
      }

      this.logger.log(
        `Доставлено userId=${userId} на ${socketIds.length} сокет(ов) (${eventName})`,
      );
    }
  }
}
