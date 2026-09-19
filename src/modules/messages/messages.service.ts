import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { types } from 'cassandra-driver';
import { SendMessageDto } from './dto/send-message.dto';
import { CassandraService } from '@common/cassandra/cassandra.service';
import { ChatsService } from '@modules/chats/chats.service';
import {
  MediaClientService,
  MediaUrlLookup,
} from '@modules/media-client/media-client.service';

interface StoredAttachment {
  media_id: string;
  url: string;
  type: string;
  file_name: string | null;
  size_byte: number | null;
  placeholder: string | null;
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly mediaClient: MediaClientService,
    private readonly cassandra: CassandraService,
    private readonly chatsService: ChatsService,
    @Inject('RABBITMQ_SERVICE') private readonly rabbitClient: ClientProxy,
    @Inject('NOTIFICATION_SERVICE')
    private readonly notificationClient: ClientProxy,
    @Inject('ASSISTANT_SERVICE') private readonly assistantClient: ClientProxy,
  ) {}

  async sendMessage(
    senderId: string,
    dto: SendMessageDto,
    viaAssistant = false,
  ) {
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
      const verifications = await Promise.all(
        dto.attachments.map((attachment) =>
          this.mediaClient.verifyMedia(attachment.mediaId, senderId),
        ),
      );

      dto.attachments.forEach((attachment, index) => {
        const verified = verifications[index];
        if (!verified.valid) {
          throw new BadRequestException(
            `Вложение ${attachment.mediaId} не найдено или не принадлежит вам`,
          );
        }
        attachment.url = verified.url;
        attachment.placeholder = verified.placeholder;
      });
    }

    const query = `
      INSERT INTO messages (chat_id, message_id, sender_id, content, created_at, type, attachments, via_assistant)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        viaAssistant,
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
      viaAssistant,
    });

    this.notificationClient.emit('message.sent', {
      chatId: dto.chatId,
      senderId,
      content: dto.content,
      recipientIds,
    });

    this.assistantClient.emit('message.sent', {
      chatId: dto.chatId,
      messageId: messageId.toString(),
      senderId,
      content: dto.content,
      recipientIds,
      viaAssistant,
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

  async getHistory(
    chatId: string,
    userId: string,
    limit = 50,
    beforeMessageId?: string,
  ): Promise<Record<string, unknown>[]> {
    await this.chatsService.assertMember(chatId, userId);

    const params: unknown[] = [chatId];
    let query = `SELECT * FROM messages WHERE chat_id = ?`;
    if (beforeMessageId) {
      query += ` AND message_id < ?`;
      params.push(types.TimeUuid.fromString(beforeMessageId));
    }
    query += ` LIMIT ?`;
    params.push(limit);

    const result = await this.cassandra.client.execute(query, params, {
      prepare: true,
    });

    const mediaIds: string[] = [
      ...new Set(
        result.rows.flatMap((row) =>
          ((row.get('attachments') as StoredAttachment[] | null) ?? []).map(
            (attachment) => attachment.media_id,
          ),
        ),
      ),
    ];

    const urlById: Map<string, MediaUrlLookup> = mediaIds.length
      ? await this.mediaClient.getMediaUrls(mediaIds)
      : new Map<string, MediaUrlLookup>();

    return result.rows.map((row) => ({
      ...row,
      attachments: (
        (row.get('attachments') as StoredAttachment[] | null) ?? []
      ).map((attachment) => {
        // No entry means MediaService doesn't know this mediaId at all — treat
        // the same as isAvailable: false rather than falling back to the
        // presigned URL captured at send time, which expires and would look
        // like a broken image instead of an explicit "file gone" state.
        const lookup = urlById.get(attachment.media_id);
        const isAvailable = lookup?.isAvailable ?? false;
        return {
          ...attachment,
          url: isAvailable ? (lookup?.url ?? null) : null,
          isAvailable,
        };
      }),
    }));
  }
}
