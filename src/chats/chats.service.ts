import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { types } from 'cassandra-driver';
import { CassandraService } from 'src/cassandra/cassandra.service';
import { CreateChatDto } from 'src/chats/dto/creat-chat.dto';

@Injectable()
export class ChatsService {
  constructor(private readonly cassandra: CassandraService) {}

  async createChat(creatorId: string, dto: CreateChatDto) {
    if (dto.type === 'direct' && dto.memberIds.length !== 1) {
      throw new BadRequestException(
        'Личный чат должен содержать ровно одного собеседника',
      );
    }

    const chatId = types.Uuid.random();
    const createdAt = new Date();
    const otherMemberIds = [...new Set(dto.memberIds)].filter(
      (id) => id !== creatorId,
    );

    await this.cassandra.client.execute(
      `INSERT INTO chats (chat_id, type, title, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
      [chatId, dto.type, dto.title ?? null, creatorId, createdAt],
      { prepare: true },
    );

    const memberEntries = [
      { userId: creatorId, role: 'admin' },
      ...otherMemberIds.map((userId) => ({ userId, role: 'member' })),
    ];

    const queries = memberEntries.flatMap(({ userId, role }) => [
      {
        query: `INSERT INTO chat_members (chat_id, user_id, joined_at, role) VALUES (?, ?, ?, ?)`,
        params: [chatId, userId, createdAt, role],
      },
      {
        query: `INSERT INTO user_chats (user_id, chat_id, joined_at) VALUES (?, ?, ?)`,
        params: [userId, chatId, createdAt],
      },
    ]);

    await this.cassandra.client.batch(queries, { prepare: true });

    return {
      chatId: chatId.toString(),
      creatorId,
      type: dto.type,
      title: dto.title,
      members: memberEntries, //.map((m) => m.userId),
    };
  }

  async getUserChats(userId: string) {
    const result = await this.cassandra.client.execute(
      `SELECT * FROM user_chats WHERE user_id = ?`,
      [userId],
      { prepare: true },
    );

    return result.rows;
  }

  async isMember(chatId: string, userId: string): Promise<boolean> {
    const result = await this.cassandra.client.execute(
      `SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id = ?`,
      [chatId, userId],
      { prepare: true },
    );
    return result.rowLength > 0;
  }

  async assertMember(chatId: string, userId: string) {
    const member = await this.isMember(chatId, userId);
    if (!member) {
      throw new ForbiddenException('Вы не состоите в этом чате');
    }
  }

  async getMemberRole(chatId: string, userId: string): Promise<string | null> {
    const result = await this.cassandra.client.execute(
      `SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?`,
      [chatId, userId],
      { prepare: true },
    );
    if (result.rowLength === 0) {
      return null;
    }
    return result.first().role;
  }

  async assertAdmin(chatId: string, userId: string) {
    const role = await this.getMemberRole(chatId, userId);
    if (role !== 'admin') {
      throw new ForbiddenException(
        'Только администратор группы может выполнить это действие',
      );
    }
  }

  async getChat(chatId: string) {
    const result = await this.cassandra.client.execute(
      `SELECT * FROM chats WHERE chat_id = ?`,
      [chatId],
      { prepare: true },
    );
    if (result.rowLength === 0) {
      throw new NotFoundException('Чат не найден');
    }
    return result.first();
  }

  async addMembers(
    chatId: string,
    requesterId: string,
    newMemberIds: string[],
  ) {
    const chat = await this.getChat(chatId);
    if (chat.type !== 'group') {
      throw new BadRequestException(
        'Добавлять участников можно только в групповой чат',
      );
    }

    await this.assertAdmin(chatId, requesterId);

    const uniqueIds = [...new Set(newMemberIds)].filter(
      (id) => id !== requesterId,
    );

    if (uniqueIds.length === 0) {
      throw new BadRequestException('Нет новых участников для добавления');
    }

    const alreadyMembersFlags = await Promise.all(
      uniqueIds.map((id) => this.isMember(chatId, id)),
    );
    const idsToAdd = uniqueIds.filter(
      (_, index) => !alreadyMembersFlags[index],
    );

    if (idsToAdd.length === 0) {
      throw new ConflictException(
        'Все указанные пользователи уже состоят в чате',
      );
    }

    const joinedAt = new Date();

    const queries = idsToAdd.flatMap((userId) => [
      {
        query: `INSERT INTO chat_members (chat_id, user_id, joined_at, role) VALUES (?, ?, ?, ?)`,
        params: [chatId, userId, joinedAt, 'member'],
      },
      {
        query: `INSERT INTO user_chats (user_id, chat_id, joined_at) VALUES (?, ?, ?)`,
        params: [userId, chatId, joinedAt],
      },
    ]);

    await this.cassandra.client.batch(queries, { prepare: true });

    return { chatId, addedMemberIds: idsToAdd };
  }

  async removeMember(
    chatId: string,
    requesterId: string,
    targetUserId: string,
  ) {
    await this.assertAdmin(chatId, requesterId);

    if (requesterId === targetUserId) {
      throw new BadRequestException(
        'Нельзя удалить самого себя таким способом — используйте выход из группы',
      );
    }

    const targetIsMember = await this.isMember(chatId, targetUserId);
    if (!targetIsMember) {
      throw new NotFoundException('Этот пользователь не состоит в чате');
    }

    await this.cassandra.client.batch(
      [
        {
          query: `DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?`,
          params: [chatId, targetUserId],
        },
        {
          query: `DELETE FROM user_chats WHERE user_id = ? AND chat_id = ?`,
          params: [targetUserId, chatId],
        },
      ],
      { prepare: true },
    );

    return { chatId, removedUserId: targetUserId };
  }
}
