import { Injectable, BadRequestException } from '@nestjs/common';
import { types } from 'cassandra-driver';
import { CassandraService } from '../cassandra/cassandra.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatsService } from 'src/chats/chats.service';

@Injectable()
export class MessagesService {
  constructor(
    private readonly cassandra: CassandraService,
    private readonly chatsService: ChatsService,
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
        })) ?? null,
      ],
      { prepare: true },
    );

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
