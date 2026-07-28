import { AppDataSource } from './data-source';

describe('AppDataSource', () => {
  it('should be defined and configured with synchronize: false', () => {
    expect(AppDataSource).toBeDefined();
    expect(AppDataSource.options.type).toBe('postgres');
    expect(AppDataSource.options.synchronize).toBe(false);
  });
});
