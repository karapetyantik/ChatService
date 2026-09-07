import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GrpcChatController } from './grpc-chat.controller';
import { ChatsService } from '@modules/chats/chats.service';
import { MessagesService } from '@modules/messages/messages.service';

describe('GrpcChatController', () => {
  let controller: GrpcChatController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GrpcChatController],
      providers: [
        { provide: ChatsService, useValue: {} },
        { provide: MessagesService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('test-key') },
        },
      ],
    }).compile();

    controller = module.get<GrpcChatController>(GrpcChatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
