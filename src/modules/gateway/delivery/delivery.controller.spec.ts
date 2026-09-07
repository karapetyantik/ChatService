import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryController } from './delivery.controller';
import { ChatGateway } from '../chat.gateway';
import { RedisService } from '@common/redis/redis.service';

describe('DeliveryController', () => {
  let controller: DeliveryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeliveryController],
      providers: [
        { provide: ChatGateway, useValue: { server: { to: jest.fn() } } },
        {
          provide: RedisService,
          useValue: { client: { smembers: jest.fn().mockResolvedValue([]) } },
        },
      ],
    }).compile();

    controller = module.get<DeliveryController>(DeliveryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
