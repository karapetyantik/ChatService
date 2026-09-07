import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '@common/redis/redis.service';

// WebSocketGateway options are evaluated at class-definition time, before
// Nest's DI container exists, so ConfigService can't be injected here —
// read the allowed origin straight from the environment instead.
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
}
