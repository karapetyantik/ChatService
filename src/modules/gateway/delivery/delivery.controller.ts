import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { ChatGateway } from '../chat.gateway';
import { RedisService } from 'src/common/redis/redis.service';

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

@Controller()
export class DeliveryController {
  private readonly logger = new Logger(DeliveryController.name);

  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly redisService: RedisService,
  ) {}

  @EventPattern('message.sent')
  async handleMessageSent(@Payload() event: MessageSentEvent) {
    for (const userId of event.recipientIds) {
      const socketIds = await this.redisService.client.smembers(
        `user_sockets:${userId}`,
      );

      for (const socketId of socketIds) {
        this.chatGateway.server.to(socketId).emit('message', event);
      }

      this.logger.log(
        `Доставлено userId=${userId} на ${socketIds.length} сокет(ов)`,
      );
    }
  }

  @EventPattern('message.reaction')
  async handleMessageReaction(@Payload() event: MessageReactionEvent) {
    for (const recipientId of event.recipientIds) {
      const socketIds = await this.redisService.client.smembers(
        `user_sockets:${recipientId}`,
      );
      for (const socketId of socketIds) {
        this.chatGateway.server.to(socketId).emit('reaction', event);
      }
    }
    this.logger.log(
      `Реакция ${event.action} разослана по чату ${event.chatId}`,
    );
  }

  @EventPattern('chat.read')
  async handleChatRead(
    @Payload()
    event: {
      chatId: string;
      userId: string;
      lastReadMessageId: string;
      recipientIds: string[];
    },
  ) {
    for (const recipientId of event.recipientIds) {
      if (recipientId === event.userId) continue;
      const socketIds = await this.redisService.client.smembers(
        `user_sockets:${recipientId}`,
      );
      for (const socketId of socketIds) {
        this.chatGateway.server.to(socketId).emit('read', event);
      }
    }
  }
}
