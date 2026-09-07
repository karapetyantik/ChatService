import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MediaClientService } from './media-client.service';

describe('MediaClientService', () => {
  let service: MediaClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaClientService,
        {
          provide: 'MEDIA_GRPC_SERVICE',
          useValue: { getService: jest.fn().mockReturnValue({}) },
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('test-key') },
        },
      ],
    }).compile();

    service = module.get<MediaClientService>(MediaClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
