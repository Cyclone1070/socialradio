import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3StorageService } from './s3-storage.service';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

jest.mock('@aws-sdk/client-s3');

describe('S3StorageService', () => {
  let service: S3StorageService;
  let mockS3Send: jest.Mock;

  beforeEach(async () => {
    mockS3Send = jest.fn();
    (S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(() => {
      return {
        send: mockS3Send,
      } as unknown as S3Client;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3StorageService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const env: Record<string, string> = {
                STORAGE_ENDPOINT: 'http://localhost:9000',
                STORAGE_BUCKET: 'socialradio-media',
                STORAGE_ACCESS_KEY: 'minioadmin',
                STORAGE_SECRET_KEY: 'minioadmin',
                STORAGE_PUBLIC_URL: 'http://localhost:9000/socialradio-media',
              };
              return env[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<S3StorageService>(S3StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should write object to S3 bucket using PutObjectCommand', async () => {
    mockS3Send.mockResolvedValue({});

    await service.write({
      key: 'channels/1/chunk_001.ts',
      content: Buffer.from('test-audio'),
      contentType: 'video/mp2t',
      cacheControl: 'public, max-age=31536000',
    });

    expect(mockS3Send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
  });

  it('should read object from S3 bucket using GetObjectCommand', async () => {
    const mockResponseBody = {
      transformToByteArray: jest
        .fn()
        .mockResolvedValue(new Uint8Array(Buffer.from('audio-data'))),
    };
    mockS3Send.mockResolvedValue({ Body: mockResponseBody });

    const data = await service.read('channels/1/chunk_001.ts');
    expect(data.toString()).toBe('audio-data');
    expect(mockS3Send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
  });

  it('should return true for exists when HeadObjectCommand succeeds', async () => {
    mockS3Send.mockResolvedValue({});

    const result = await service.exists('channels/1/chunk_001.ts');
    expect(result).toBe(true);
    expect(mockS3Send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
  });

  it('should return false for exists when HeadObjectCommand fails with NotFound', async () => {
    mockS3Send.mockRejectedValue({ name: 'NotFound' });

    const result = await service.exists('channels/1/nonexistent.ts');
    expect(result).toBe(false);
  });

  it('should delete object from S3 bucket using DeleteObjectCommand', async () => {
    mockS3Send.mockResolvedValue({});

    await service.delete('channels/1/chunk_001.ts');
    expect(mockS3Send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
  });

  it('should construct correct public CDN URL', () => {
    const url = service.getPublicUrl('channels/1/chunk_001.ts');
    expect(url).toBe(
      'http://localhost:9000/socialradio-media/channels/1/chunk_001.ts',
    );
  });
});
