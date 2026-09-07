import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { RedisModule } from '@common/redis/redis.module';
import { DeliveryController } from './delivery/delivery.controller';

@Module({
  imports: [
    RedisModule,
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [ChatGateway],
  controllers: [DeliveryController],
})
export class GatewayModule {}
