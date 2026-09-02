import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CassandraModule } from './common/cassandra/cassandra.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './common/auth/auth.module';
import { MessagesModule } from './modules/messages/messages.module';
import { ChatsModule } from './modules/chats/chats.module';
import { RedisModule } from './common/redis/redis.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { GrpcChatController } from './modules/chats/grpc-chat/grpc-chat.controller';
import { MediaClientModule } from './modules/media-client/media-client.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CassandraModule,
    AuthModule,
    MessagesModule,
    ChatsModule,
    RedisModule,
    GatewayModule,
    MediaClientModule,
  ],
  controllers: [AppController, GrpcChatController],
  providers: [AppService],
})
export class AppModule {}
