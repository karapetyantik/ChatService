import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { AppModule } from './app.module';
import { RedisIoAdapter } from '@modules/gateway/adapters/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  const configService = app.get(ConfigService);

  const redisIoAdapter = new RedisIoAdapter(app);
  redisIoAdapter.connectToRedis(
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
      protoPath: join(process.cwd(), 'dist/proto/chat.proto'),
      url: configService.get<string>('CHAT_GRPC_URL', '0.0.0.0:5001'),
    },
  });

  await app.startAllMicroservices();
  await app.listen(configService.get<number>('PORT', 3002));
}
void bootstrap();
