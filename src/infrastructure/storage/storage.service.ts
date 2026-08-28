import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
export interface WriteParams {
  key: string;
  content: string | Buffer;
  contentType?: string;
  cacheControl?: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint =
      this.configService.get<string>('STORAGE_ENDPOINT') ||
      'http://localhost:9000';
    const accessKeyId =
      this.configService.get<string>('STORAGE_ACCESS_KEY') || 'minioadmin';
    const secretAccessKey =
      this.configService.get<string>('STORAGE_SECRET_KEY') || 'minioadmin';

    this.bucketName =
      this.configService.get<string>('STORAGE_BUCKET') || 'socialradio-media';
    const publicUrl = this.configService.get<string>('STORAGE_PUBLIC_URL');
    this.publicBaseUrl = publicUrl
      ? publicUrl.replace(/\/$/, '')
      : `${endpoint.replace(/\/$/, '')}/${this.bucketName}`;

    this.s3Client = new S3Client({
      endpoint,
      region: 'auto',
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // Required for MinIO path-style bucket routing
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  async ensureBucketExists(): Promise<void> {
    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.bucketName }),
      );
    } catch {
      try {
        await this.s3Client.send(
          new CreateBucketCommand({ Bucket: this.bucketName }),
        );
        this.logger.log(`Created bucket: ${this.bucketName}`);
      } catch (err) {
        this.logger.warn(`Could not create bucket ${this.bucketName}: ${err}`);
      }
    }

    try {
      const publicReadPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PublicReadGetObject',
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject', 's3:PutObject'],
            Resource: [`arn:aws:s3:::${this.bucketName}/*`],
          },
        ],
      };
      await this.s3Client.send(
        new PutBucketPolicyCommand({
          Bucket: this.bucketName,
          Policy: JSON.stringify(publicReadPolicy),
        }),
      );
    } catch (err) {
      this.logger.debug(
        `Could not set public read policy on bucket ${this.bucketName}: ${err}`,
      );
    }
  }

  async write(params: WriteParams): Promise<void> {
    const body =
      typeof params.content === 'string'
        ? Buffer.from(params.content)
        : params.content;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: params.key,
      Body: body,
      ContentType: params.contentType || 'application/octet-stream',
      CacheControl: params.cacheControl || 'public, max-age=31536000',
    });

    await this.s3Client.send(command);
    this.logger.debug(`Uploaded object to S3: ${params.key}`);
  }

  async read(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    if (!response.Body) {
      throw new Error(`Object body is empty for key: ${key}`);
    }

    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.s3Client.send(command);
    this.logger.debug(`Deleted object from S3: ${key}`);
  }

  getPublicUrl(key: string): string {
    const cleanKey = key.replace(/^\//, '');
    return `${this.publicBaseUrl}/${cleanKey}`;
  }
}
