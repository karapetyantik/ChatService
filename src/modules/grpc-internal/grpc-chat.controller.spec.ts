import { Test, TestingModule } from '@nestjs/testing';
import { GrpcChatController } from '../chats/grpc-chat/grpc-chat.controller';

describe('GrpcChatController', () => {
  let controller: GrpcChatController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GrpcChatController],
    }).compile();

    controller = module.get<GrpcChatController>(GrpcChatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
