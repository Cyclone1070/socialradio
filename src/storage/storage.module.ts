import { Module } from '@nestjs/common';
import { S3StorageService } from './s3-storage.service';

@Module({
  providers: [
    S3StorageService,
    {
      provide: 'StorageService',
      useClass: S3StorageService,
    },
  ],
  exports: [S3StorageService, 'StorageService'],
})
export class StorageModule {}
