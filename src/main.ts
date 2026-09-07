import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { join } from 'path';
import { RedisIoAdapter } from '@modules/gateway/adapters/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  const configService = app.get(ConfigService);

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(
    configService.get<string>('REDIS_HOST', 'localhost'),
    configService.get<number>('REDIS_PORT', 6379),
  );
  app.useWebSocketAdapter(redisIoAdapter);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [configService.getOrThrow<string>('RABBITMQ_URL')],
      queue: 'chat_events',
      queueOptions: { durable: true },
    },
  });

  app.connectMicroservice({
    transport: Transport.GRPC,
    options: {
      package: 'chat',
      protoPath: join(__dirname, '../src/proto/chat.proto'),
      url: '0.0.0.0:5001',
    },
  });

  await app.startAllMicroservices();
  await app.listen(configService.get<number>('PORT', 3002));
}
bootstrap();
