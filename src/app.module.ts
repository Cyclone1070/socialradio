import { Module } from '@nestjs/common';
import { IngestionModule } from './features/ingestion/ingestion.module';

@Module({
  imports: [IngestionModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
