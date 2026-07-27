export interface WriteParams {
  key: string;
  content: string | Buffer;
  contentType?: string;
  cacheControl?: string;
}

export interface StorageService {
  write(params: WriteParams): Promise<void>;
  read(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): string;
}
