import { LoggingModule } from './logging/logging.module';
import { StorageModule } from './storage/storage.module';
import { HealthcheckModule } from './healthcheck/healthcheck.module';

describe('Infrastructure Modules', () => {
  it('should export infrastructure modules', () => {
    expect(LoggingModule).toBeDefined();
    expect(StorageModule).toBeDefined();
    expect(HealthcheckModule).toBeDefined();
  });
});
