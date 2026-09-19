import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { RedisService } from '@common/redis/redis.service';

const FRONTEND_ORIGIN = process.env.FRONTEND_URL ?? 'http://localhost:5173';

interface SocketData {
  userId?: string;
}

@Injectable()
@WebSocketGateway({ cors: { origin: FRONTEND_ORIGIN } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token: string | undefined =
        (client.handshake.auth?.token as string | undefined) ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        throw new Error('No token provided');
      }

      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
      const userId = payload.sub;

      (client.data as SocketData).userId = userId;
      await this.redisService.client.sadd(`user_sockets:${userId}`, client.id);
      await this.redisService.client.expire(`user_sockets:${userId}`, 86_400); //временно

      this.logger.log(
        `Клиент подключён: userId=${userId}, socketId=${client.id}`,
      );
    } catch (error) {
      this.logger.warn(
        `Отклонено неавторизованное подключение ${client.id}: ${error instanceof Error ? error.message : error}`,
      );
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = (client.data as SocketData).userId;
    if (userId) {
      await this.redisService.client.srem(`user_sockets:${userId}`, client.id);
      this.logger.log(
        `Клиент отключён: userId=${userId}, socketId=${client.id}`,
      );
    }
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() client: Socket,
  ): Promise<{ event: 'heartbeat'; data: { ok: boolean } }> {
    const userId = (client.data as SocketData).userId;
    if (userId) {
      await this.redisService.client.sadd(`user_sockets:${userId}`, client.id);
      await this.redisService.client.expire(`user_sockets:${userId}`, 3600);
    }
    return { event: 'heartbeat', data: { ok: true } };
  }
}
