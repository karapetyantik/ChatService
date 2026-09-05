import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { types } from 'cassandra-driver';
import { ClientProxy } from '@nestjs/microservices';
import { CassandraService } from '../../common/cassandra/cassandra.service';
import { ChatsService } from 'src/modules/chats/chats.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MediaClientService } from '../media-client/media-client.service';

@Injectable()
export class MessagesService {
  constructor(
    private readonly mediaClient: MediaClientService,
    private readonly cassandra: CassandraService,
    private readonly chatsService: ChatsService,
    @Inject('RABBITMQ_SERVICE') private readonly rabbitClient: ClientProxy,
    @Inject('NOTIFICATION_SERVICE')
    private readonly notificationClient: ClientProxy,
  ) {}

  async sendMessage(senderId: string, dto: SendMessageDto) {
    if (!dto.content && (!dto.attachments || dto.attachments.length === 0)) {
      throw new BadRequestException(
        'Сообщение должно содержать текст или хотя бы одно вложение',
      );
    }

    await this.chatsService.assertMember(dto.chatId, senderId);

    const messageId = types.TimeUuid.now();
    const createdAt = new Date();

    const type = dto.attachments?.length
      ? dto.content
        ? 'mixed'
        : dto.attachments[0].type
      : 'text';

    if (dto.attachments?.length) {
      for (const attachment of dto.attachments) {
        const verified = await this.mediaClient.verifyMedia(
          attachment.mediaId,
          senderId,
        );
        if (!verified.valid) {
          throw new BadRequestException(
            `Вложение ${attachment.mediaId} не найдено или не принадлежит вам`,
          );
        }
        attachment.url = verified.url;
        attachment.placeholder = verified.placeholder;
      }
    }

    const query = `
    INSERT INTO messages (chat_id, message_id, sender_id, content, created_at, type, attachments)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

    await this.cassandra.client.execute(
      query,
      [
        dto.chatId,
        messageId,
        senderId,
        dto.content ?? null,
        createdAt,
        type,
        dto.attachments?.map((a) => ({
          media_id: a.mediaId,
          url: a.url,
          type: a.type,
          file_name: a.fileName ?? null,
          size_bytes: a.sizeBytes ?? null,
          placeholder: a.placeholder ?? null,
        })) ?? null,
      ],
      { prepare: true },
    );

    const recipientIds = await this.chatsService.getMemberIds(dto.chatId);

    this.rabbitClient.emit('message.sent', {
      chatId: dto.chatId,
      messageId: messageId.toString(),
      senderId,
      content: dto.content,
      attachments: dto.attachments,
      type,
      createdAt,
      recipientIds,
    });

    this.notificationClient.emit('message.sent', {
      chatId: dto.chatId,
      senderId,
      content: dto.content,
      recipientIds,
    });

    return {
      chatId: dto.chatId,
      messageId: messageId.toString(),
      senderId,
      content: dto.content,
      type,
      attachments: dto.attachments,
      createdAt,
    };
  }

  async getHistory(chatId: string, userId: string, limit = 50) {
    await this.chatsService.assertMember(chatId, userId);

    const result = await this.cassandra.client.execute(
      `SELECT * FROM messages WHERE chat_id = ? LIMIT ?`,
      [chatId, limit],
      { prepare: true },
    );
    return result.rows;
  }
}
