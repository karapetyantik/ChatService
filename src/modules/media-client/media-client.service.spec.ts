import { Test, TestingModule } from '@nestjs/testing';
import { MediaClientService } from './media-client.service';

describe('MediaClientService', () => {
  let service: MediaClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MediaClientService],
    }).compile();

    service = module.get<MediaClientService>(MediaClientService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
